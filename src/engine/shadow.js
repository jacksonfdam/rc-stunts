/**
 * Owns the sun's shadow tunables and keeps the shadow frustum centred on a
 * moving target. Shared by both entry points; each passes its own sun light.
 *
 * `overrides` seeds the sun offset and frustum size; everything else is read
 * from the light's current shadow settings.
 */
export function createShadowController(sun, overrides = {}) {
  // sunX/Y/Z are the light's offset from the followed point (see follow()).
  const shadowParams = {
    sunX: overrides.sunX ?? sun.position.x,
    sunY: overrides.sunY ?? sun.position.y,
    sunZ: overrides.sunZ ?? sun.position.z,
    shadowMapSize: sun.shadow.mapSize.x,
    shadowCameraSize: overrides.shadowCameraSize ?? 80,
    shadowBias: sun.shadow.bias,
    shadowNormalBias: sun.shadow.normalBias,
    shadowRadius: sun.shadow.radius,
  }
  const DEFAULT_SHADOW_PARAMS = { ...shadowParams }

  function applyShadowParams() {
    sun.shadow.camera.left = -shadowParams.shadowCameraSize
    sun.shadow.camera.right = shadowParams.shadowCameraSize
    sun.shadow.camera.top = shadowParams.shadowCameraSize
    sun.shadow.camera.bottom = -shadowParams.shadowCameraSize
    sun.shadow.bias = shadowParams.shadowBias
    sun.shadow.normalBias = shadowParams.shadowNormalBias
    sun.shadow.radius = shadowParams.shadowRadius
    sun.shadow.camera.updateProjectionMatrix()

    if (sun.shadow.mapSize.x !== shadowParams.shadowMapSize) {
      sun.shadow.mapSize.set(shadowParams.shadowMapSize, shadowParams.shadowMapSize)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
  }

  // Centre the frustum on (x, z). Snap the follow point to shadow-map texel
  // increments: moving by sub-texel amounts re-rasterises every edge each
  // frame, which shows up as crawling/shimmering shadow edges while driving.
  function follow(centerX, centerZ) {
    const texel = (shadowParams.shadowCameraSize * 2) / shadowParams.shadowMapSize
    const fx = Math.round(centerX / texel) * texel
    const fz = Math.round(centerZ / texel) * texel
    sun.position.set(fx + shadowParams.sunX, shadowParams.sunY, fz + shadowParams.sunZ)
    sun.target.position.set(fx, 0, fz)
    sun.target.updateMatrixWorld()
  }

  applyShadowParams()

  return { shadowParams, DEFAULT_SHADOW_PARAMS, applyShadowParams, follow }
}
