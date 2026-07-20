import * as THREE from 'three'
import * as CANNON from 'cannon-es'

/**
 * Wireframe overlay of every physics collider plus each wheel's suspension ray.
 * Shared by both entry points; toggled from their Debug GUI folder. Rebuilds
 * when the body count changes (levels/tracks recreate their colliders).
 */
export function createPhysicsDebug(scene, physicsWorld, vehicle) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const colliderMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  })
  const rayMaterial = new THREE.LineBasicMaterial({
    color: 0xff00ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  })

  const colliders = []
  const rayLines = []

  const getGeometry = (shape) => {
    if (shape instanceof CANNON.Box) {
      const h = shape.halfExtents
      return new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2)
    }
    if (shape instanceof CANNON.Sphere) {
      return new THREE.SphereGeometry(shape.radius, 16, 8)
    }
    if (shape instanceof CANNON.Cylinder) {
      return new THREE.CylinderGeometry(
        shape.radiusTop,
        shape.radiusBottom,
        shape.height,
        shape.numSegments
      )
    }
    if (shape instanceof CANNON.Trimesh) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(shape.vertices), 3)
      )
      geometry.setIndex(Array.from(shape.indices))
      geometry.computeVertexNormals()
      return geometry
    }
    return null
  }

  const rebuild = () => {
    colliders.length = 0
    rayLines.length = 0
    group.clear()

    for (const body of physicsWorld.bodies) {
      body.shapes.forEach((shape, shapeIndex) => {
        const geometry = getGeometry(shape)
        if (!geometry) return
        const mesh = new THREE.Mesh(geometry, colliderMaterial)
        mesh.renderOrder = 1000
        group.add(mesh)
        colliders.push({ body, shapeIndex, mesh })
      })
    }

    for (let i = 0; i < vehicle.raycastVehicle.wheelInfos.length; i++) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        rayMaterial
      )
      line.renderOrder = 1001
      group.add(line)
      rayLines.push(line)
    }
  }

  const sync = () => {
    if (!group.visible) return

    colliders.forEach(({ body, shapeIndex, mesh }) => {
      const offset = body.shapeOffsets[shapeIndex]
      const orientation = body.shapeOrientations[shapeIndex]
      const rotatedOffset = body.quaternion.vmult(offset)

      mesh.position.set(
        body.position.x + rotatedOffset.x,
        body.position.y + rotatedOffset.y,
        body.position.z + rotatedOffset.z
      )
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
      mesh.quaternion.multiply(
        new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
      )
    })

    vehicle.raycastVehicle.wheelInfos.forEach((wheel, index) => {
      const line = rayLines[index]
      if (!line) return

      const start = wheel.chassisConnectionPointWorld
      const end = wheel.raycastResult.hasHit
        ? wheel.raycastResult.hitPointWorld
        : start.vadd(wheel.directionWorld.scale(wheel.suspensionRestLength + wheel.radius))

      const positions = line.geometry.attributes.position
      positions.setXYZ(0, start.x, start.y, start.z)
      positions.setXYZ(1, end.x, end.y, end.z)
      positions.needsUpdate = true
      line.geometry.computeBoundingSphere()
    })
  }

  rebuild()

  return {
    setVisible(visible) {
      if (visible && colliders.length !== physicsWorld.bodies.reduce((n, body) => n + body.shapes.length, 0)) {
        rebuild()
      }
      group.visible = visible
      sync()
    },
    update: sync,
  }
}
