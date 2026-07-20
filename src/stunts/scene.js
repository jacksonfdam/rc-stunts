import * as THREE from 'three'

import { TILE } from './StuntsTrack.js'

const HORIZON_COLOR = 0x9cc3e0

// Gradient sky dome: deep blue overhead easing to the horizon colour at the
// skyline. Unfogged and drawn behind everything.
function buildSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f6bb0) },
      horizonColor: { value: new THREE.Color(HORIZON_COLOR) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.6)), 1.0);
      }
    `,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 16), material)
}

// Distant mountain band so the horizon isn't empty. Two rings of low-poly peaks
// (green hills in front, grey/snow behind) circling the scene; unfogged so they
// read clearly on the skyline.
function buildHorizon() {
  const ring = new THREE.Group()
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x3f5d38, roughness: 1, flatShading: true, fog: false })
  const peakMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 1, flatShading: true, fog: false })
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 1, flatShading: true, fog: false })
  const layers = [
    { count: 90, R: 900, base: 60, vary: 90, rad: 90, mat: hillMat, snow: false },
    { count: 70, R: 1050, base: 130, vary: 170, rad: 120, mat: peakMat, snow: true },
  ]
  for (const L of layers) {
    for (let i = 0; i < L.count; i++) {
      const a = (i / L.count) * Math.PI * 2 + ((i * 37) % 13) * 0.01
      const h = L.base + ((i * 53) % L.vary)
      const r = L.R + ((i * 29) % 140)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(L.rad + ((i * 17) % 50), h, 5), L.mat)
      cone.position.set(Math.cos(a) * r, h / 2 - 30, Math.sin(a) * r)
      cone.rotation.y = i * 1.3
      ring.add(cone)
      if (L.snow && h > 200) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry((L.rad + ((i * 17) % 50)) * 0.4, h * 0.28, 5), snowMat)
        cap.position.set(cone.position.x, cone.position.y + h * 0.36, cone.position.z)
        cap.rotation.y = cone.rotation.y
        ring.add(cap)
      }
    }
  }
  return ring
}

/**
 * Build the Stunts renderer, scene (sky, horizon, fog), chase camera and
 * hemisphere + sun lighting. Appends the canvas to `container`.
 */
export function createStuntsScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(HORIZON_COLOR)
  // Fog fades distant ground into the horizon colour so the ground's edge and
  // the sky-dome base blend into one seamless horizon band.
  scene.fog = new THREE.Fog(HORIZON_COLOR, TILE * 16, TILE * 40)
  scene.add(buildSky())
  scene.add(buildHorizon())

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000)
  camera.position.set(0, 40, -40)

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4a3a, 1.4)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2d9, 2.4)
  sun.position.set(60, 90, 30)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -TILE * 4
  sun.shadow.camera.right = TILE * 4
  sun.shadow.camera.top = TILE * 4
  sun.shadow.camera.bottom = -TILE * 4
  sun.shadow.camera.far = 400
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.03
  scene.add(sun)
  scene.add(sun.target)

  return { renderer, scene, camera, hemi, sun }
}
