import * as THREE from 'three'

// Soft outdoor cube-map used both as the scene background and (via PMREM) as the
// reflection map for GLB materials. A plain 6-face gradient, no assets.
function createSoftOutdoorEnvironmentMaps(renderer) {
  const makeFace = (topColor, bottomColor) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, topColor)
    gradient.addColorStop(0.55, '#9fc2d4')
    gradient.addColorStop(1, bottomColor)
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }

  const cubeTexture = new THREE.CubeTexture([
    makeFace('#6687a0', '#586446'), // +x
    makeFace('#6c8ca4', '#515d3f'), // -x
    makeFace('#8daec5', '#708b9c'), // +y
    makeFace('#4f5a3d', '#303629'), // -y
    makeFace('#6689a1', '#586443'), // +z
    makeFace('#607f96', '#4f5b3d'), // -z
  ])
  cubeTexture.colorSpace = THREE.SRGBColorSpace
  cubeTexture.needsUpdate = true

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const reflectionMap = pmremGenerator.fromCubemap(cubeTexture).texture
  pmremGenerator.dispose()
  return { backgroundMap: cubeTexture, reflectionMap }
}

async function createImageReflectionMap(renderer, url) {
  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const reflectionMap = pmremGenerator.fromEquirectangular(texture).texture
  pmremGenerator.dispose()
  texture.dispose()
  return reflectionMap
}

/**
 * Build the playground renderer and scene, plus the two reflection maps.
 * `glbReflectionMap` is kept off `scene.environment` on purpose — using it there
 * would over-light/wash out the whole world; it's applied to GLB materials only.
 * Appends the canvas to `container`.
 */
export async function createPlaygroundScene(container, houseReflectionUrl) {
  // MSAA on the default framebuffer only applies when post-processing is off;
  // the composer path gets its own multisampled render targets.
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  // Plain PCF so sun.shadow.radius (the "Shadow softness" slider) applies.
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const { backgroundMap, reflectionMap: glbReflectionMap } = createSoftOutdoorEnvironmentMaps(renderer)
  const houseReflectionMap = await createImageReflectionMap(renderer, houseReflectionUrl)
  scene.background = backgroundMap

  return { renderer, scene, glbReflectionMap, houseReflectionMap }
}
