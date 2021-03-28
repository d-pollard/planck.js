/*
 * Planck.js
 * The MIT License
 * Copyright (c) 2021 Erin Catto, Ali Shakiba
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import common from './util/common';
import options from './util/options';

import Math from './common/Math';
import Vec2 from './common/Vec2';

import AABB from './collision/AABB';

import Shape, { ShapeType } from './Shape';

const _ASSERT = typeof ASSERT === 'undefined' ? false : ASSERT;

/**
 * @typedef {Object} FixtureDef
 *
 * A fixture definition is used to create a fixture. This class defines an
 * abstract fixture definition. You can reuse fixture definitions safely.
 *
 * @prop friction The friction coefficient, usually in the range [0,1]
 * @prop restitution The restitution (elasticity) usually in the range [0,1]
 * @prop density The density, usually in kg/m^2
 * @prop isSensor A sensor shape collects contact information but never
 *       generates a collision response
 * @prop userData
 * @prop filterGroupIndex Zero, positive or negative collision group. Fixtures with same positive groupIndex always collide and fixtures with same
 * negative groupIndex never collide.
 * @prop filterCategoryBits Collision category bit or bits that this fixture belongs
 *       to. If groupIndex is zero or not matching, then at least one bit in this fixture
 * categoryBits should match other fixture maskBits and vice versa.
 * @prop filterMaskBits Collision category bit or bits that this fixture accept for
 *       collision.
 */

export interface FixtureOpt {
  userData?: any;
  friction?: number;
  restitution?: number;
  density?: number;
  isSensor?: boolean;
  filterGroupIndex?: number;
  filterCategoryBits?: number;
  filterMaskBits?: number;
}

export interface FixtureDef extends FixtureOpt {
  shape: Shape;
}

const FixtureDefDefault: FixtureDef = {
  userData : null,
  friction : 0.2,
  restitution : 0.0,
  density : 0.0,
  isSensor : false,

  filterGroupIndex : 0,
  filterCategoryBits : 0x0001,
  filterMaskBits : 0xFFFF
};

/**
 * This proxy is used internally to connect shape children to the broad-phase.
 */
export class FixtureProxy {
  aabb: AABB;
  fixture: Fixture;
  childIndex: number;
  proxyId: number;
  constructor(fixture, childIndex) {
    this.aabb = new AABB();
    this.fixture = fixture;
    this.childIndex = childIndex;
    this.proxyId;
  }
}

/**
 * A fixture is used to attach a shape to a body for collision detection. A
 * fixture inherits its transform from its parent. Fixtures hold additional
 * non-geometric data such as friction, collision filters, etc. Fixtures are
 * created via Body.createFixture.
 */
export default class Fixture {
  /** @internal */ m_body: Body;
  /** @internal */ m_friction: number;
  /** @internal */ m_restitution: number;
  /** @internal */ m_density: number;
  /** @internal */ m_isSensor: boolean;
  /** @internal */ m_filterGroupIndex: number;
  /** @internal */ m_filterCategoryBits: number;
  /** @internal */ m_filterMaskBits: number;
  /** @internal */ m_shape: Shape;
  /** @internal */ m_next: Fixture | null;
  /** @internal */ m_proxies: FixtureProxy[];
  /** @internal */ m_proxyCount: number;
  /** @internal */ m_userData: unknown;

  // getType(): ShapeType;
  // getShape(): Shape;
  // isSensor(): boolean;
  // setSensor(sensor: boolean): void;
  // getUserData(): unknown;
  // setUserData(data: any): void;
  // getBody(): Body;
  // getNext(): Fixture | null;
  // getDensity(): number;
  // setDensity(density: number): void;
  // getFriction(): number;
  // setFriction(friction: number): void;
  // getRestitution(): number;
  // setRestitution(restitution: number): void;
  // testPoint(p: Vec2): boolean;
  // rayCast(output: RayCastOutput, input: RayCastInput, childIndex: number): boolean; // is childIndex optional?
  // getMassData(massData: MassData): void;
  // getAABB(childIndex: number): AABB;
  // createProxies(broadPhase: BroadPhase, xf: Transform): void; // TODO
  // destroyProxies(broadPhase: BroadPhase): void;
  // synchronize(broadPhase: BroadPhase, xf1: Transform, xf2: Transform): void;
  // setFilterData(filter: { groupIndex: number, categoryBits: number, maskBits: number }): void;
  // getFilterGroupIndex(): number;
  // getFilterCategoryBits(): number;
  // getFilterMaskBits(): number;
  // refilter(): void;
  // shouldCollide(that: Fixture): boolean;

  constructor(body: Body, def: FixtureDef);
  constructor(body: Body, shape: Shape, def?: FixtureOpt);
  constructor(body: Body, shape: Shape, density?: number);
  constructor(body, shape?, def?) {
    if (shape.shape) {
      def = shape;
      shape = shape.shape;

    } else if (typeof def === 'number') {
      def = {density : def};
    }

    def = options(def, FixtureDefDefault);

    this.m_body = body;

    this.m_friction = def.friction;
    this.m_restitution = def.restitution;
    this.m_density = def.density;
    this.m_isSensor = def.isSensor;

    this.m_filterGroupIndex = def.filterGroupIndex;
    this.m_filterCategoryBits = def.filterCategoryBits;
    this.m_filterMaskBits = def.filterMaskBits;

    // TODO validate shape
    this.m_shape = shape; //.clone();

    this.m_next = null;

    this.m_proxies = [];
    this.m_proxyCount = 0;

    var childCount = this.m_shape.getChildCount();
    for (var i = 0; i < childCount; ++i) {
      this.m_proxies[i] = new FixtureProxy(this, i);
    }

    this.m_userData = def.userData;
  }

  /**
   * Re-setup fixture.
   * @private
   */
  _reset() {
    var body = this.getBody();
    var broadPhase = body.m_world.m_broadPhase;
    this.destroyProxies(broadPhase);
    if (this.m_shape._reset) {
      this.m_shape._reset();
    }
    var childCount = this.m_shape.getChildCount();
    for (var i = 0; i < childCount; ++i) {
      this.m_proxies[i] = new FixtureProxy(this, i);
    }
    this.createProxies(broadPhase, body.m_xf);
    body.resetMassData();
  };

  _serialize() {
    return {
      friction: this.m_friction,
      restitution: this.m_restitution,
      density: this.m_density,
      isSensor: this.m_isSensor,

      filterGroupIndex: this.m_filterGroupIndex,
      filterCategoryBits: this.m_filterCategoryBits,
      filterMaskBits: this.m_filterMaskBits,

      shape: this.m_shape,
    };
  };

  static _deserialize(data, body, restore) {
    var shape = restore(Shape, data.shape);
    var fixture = shape && new Fixture(body, shape, data);
    return fixture;
  };

  /**
   * Get the type of the child shape. You can use this to down cast to the
   * concrete shape.
   */
  getType() {
    return this.m_shape.getType();
  }

  /**
   * Get the child shape. You can modify the child shape, however you should not
   * change the number of vertices because this will crash some collision caching
   * mechanisms. Manipulating the shape may lead to non-physical behavior.
   */
  getShape() {
    return this.m_shape;
  }
  /**
   * A sensor shape collects contact information but never generates a collision
   * response.
   */
  isSensor() {
    return this.m_isSensor;
  }

  /**
   * Set if this fixture is a sensor.
   */
  setSensor(sensor) {
    if (sensor != this.m_isSensor) {
      this.m_body.setAwake(true);
      this.m_isSensor = sensor;
    }
  }

  /**
   * Get the contact filtering data.
   */
// getFilterData() {
//   return this.m_filter;
// }

  /**
   * Get the user data that was assigned in the fixture definition. Use this to
   * store your application specific data.
   */
  getUserData() {
    return this.m_userData;
  }

  /**
   * Set the user data. Use this to store your application specific data.
   */
  setUserData(data) {
    this.m_userData = data;
  }

  /**
   * Get the parent body of this fixture. This is null if the fixture is not
   * attached.
   */
  getBody() {
    return this.m_body;
  }

  /**
   * Get the next fixture in the parent body's fixture list.
   */
  getNext() {
    return this.m_next;
  }

  /**
   * Get the density of this fixture.
   */
  getDensity() {
    return this.m_density;
  }

  /**
   * Set the density of this fixture. This will _not_ automatically adjust the
   * mass of the body. You must call Body.resetMassData to update the body's mass.
   */
  setDensity(density) {
    _ASSERT && common.assert(Math.isFinite(density) && density >= 0.0);
    this.m_density = density;
  }

  /**
   * Get the coefficient of friction, usually in the range [0,1].
   */
  getFriction() {
    return this.m_friction;
  }

  /**
   * Set the coefficient of friction. This will not change the friction of
   * existing contacts.
   */
  setFriction(friction) {
    this.m_friction = friction;
  }

  /**
   * Get the coefficient of restitution.
   */
  getRestitution() {
    return this.m_restitution;
  }

  /**
   * Set the coefficient of restitution. This will not change the restitution of
   * existing contacts.
   */
  setRestitution(restitution) {
    this.m_restitution = restitution;
  }

  /**
   * Test a point in world coordinates for containment in this fixture.
   */
  testPoint(p) {
    return this.m_shape.testPoint(this.m_body.getTransform(), p);
  }

  /**
   * Cast a ray against this shape.
   */
  rayCast(output, input, childIndex) {
    return this.m_shape.rayCast(output, input, this.m_body.getTransform(), childIndex);
  }

  /**
   * Get the mass data for this fixture. The mass data is based on the density and
   * the shape. The rotational inertia is about the shape's origin. This operation
   * may be expensive.
   */
  getMassData(massData) {
    this.m_shape.computeMass(massData, this.m_density);
  }

  /**
   * Get the fixture's AABB. This AABB may be enlarge and/or stale. If you need a
   * more accurate AABB, compute it using the shape and the body transform.
   */
  getAABB(childIndex) {
    _ASSERT && common.assert(0 <= childIndex && childIndex < this.m_proxyCount);
    return this.m_proxies[childIndex].aabb;
  }

  /**
   * These support body activation/deactivation.
   */
  createProxies(broadPhase, xf) {
    _ASSERT && common.assert(this.m_proxyCount == 0);

    // Create proxies in the broad-phase.
    this.m_proxyCount = this.m_shape.getChildCount();

    for (var i = 0; i < this.m_proxyCount; ++i) {
      var proxy = this.m_proxies[i];
      this.m_shape.computeAABB(proxy.aabb, xf, i);
      proxy.proxyId = broadPhase.createProxy(proxy.aabb, proxy);
    }
  }

  destroyProxies(broadPhase) {
    // Destroy proxies in the broad-phase.
    for (var i = 0; i < this.m_proxyCount; ++i) {
      var proxy = this.m_proxies[i];
      broadPhase.destroyProxy(proxy.proxyId);
      proxy.proxyId = null;
    }

    this.m_proxyCount = 0;
  }

  /**
   * Updates this fixture proxy in broad-phase (with combined AABB of current and
   * next transformation).
   */
  synchronize(broadPhase, xf1, xf2) {
    for (var i = 0; i < this.m_proxyCount; ++i) {
      var proxy = this.m_proxies[i];
      // Compute an AABB that covers the swept shape (may miss some rotation
      // effect).
      var aabb1 = new AABB();
      var aabb2 = new AABB();
      this.m_shape.computeAABB(aabb1, xf1, proxy.childIndex);
      this.m_shape.computeAABB(aabb2, xf2, proxy.childIndex);

      proxy.aabb.combine(aabb1, aabb2);

      var displacement = Vec2.sub(xf2.p, xf1.p);

      broadPhase.moveProxy(proxy.proxyId, proxy.aabb, displacement);
    }
  }

  /**
   * Set the contact filtering data. This will not update contacts until the next
   * time step when either parent body is active and awake. This automatically
   * calls refilter.
   */
  setFilterData(filter) {
    this.m_filterGroupIndex = filter.groupIndex;
    this.m_filterCategoryBits = filter.categoryBits;
    this.m_filterMaskBits = filter.maskBits;
    this.refilter();
  }

  getFilterGroupIndex() {
    return this.m_filterGroupIndex;
  }

  setFilterGroupIndex(groupIndex) {
    return this.m_filterGroupIndex = groupIndex;
  }

  getFilterCategoryBits() {
    return this.m_filterCategoryBits;
  }

  setFilterCategoryBits(categoryBits) {
    this.m_filterCategoryBits = categoryBits;
  }

  getFilterMaskBits() {
    return this.m_filterMaskBits;
  }

  setFilterMaskBits(maskBits) {
    this.m_filterMaskBits = maskBits;
  }

  /**
   * Call this if you want to establish collision that was previously disabled by
   * ContactFilter.
   */
  refilter() {
    if (this.m_body == null) {
      return;
    }

    // Flag associated contacts for filtering.
    var edge = this.m_body.getContactList();
    while (edge) {
      var contact = edge.contact;
      var fixtureA = contact.getFixtureA();
      var fixtureB = contact.getFixtureB();
      if (fixtureA == this || fixtureB == this) {
        contact.flagForFiltering();
      }

      edge = edge.next;
    }

    var world = this.m_body.getWorld();

    if (world == null) {
      return;
    }

    // Touch each proxy so that new pairs may be created
    var broadPhase = world.m_broadPhase;
    for (var i = 0; i < this.m_proxyCount; ++i) {
      broadPhase.touchProxy(this.m_proxies[i].proxyId);
    }
  }

  /**
   * Implement this method to provide collision filtering, if you want finer
   * control over contact creation.
   *
   * Return true if contact calculations should be performed between these two
   * fixtures.
   *
   * Warning: for performance reasons this is only called when the AABBs begin to
   * overlap.
   *
   * @param {Fixture} that
   */
  shouldCollide(that) {

    if (that.m_filterGroupIndex === this.m_filterGroupIndex && that.m_filterGroupIndex !== 0) {
      return that.m_filterGroupIndex > 0;
    }

    var collideA = (that.m_filterMaskBits & this.m_filterCategoryBits) !== 0;
    var collideB = (that.m_filterCategoryBits & this.m_filterMaskBits) !== 0;
    var collide = collideA && collideB;
    return collide;
  }
}
