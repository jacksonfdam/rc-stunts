import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// Shared post-processing chain used by both the arcade playground and the
// Stunts port: a color-grade pass (grade + vignette + chromatic aberration +
// film noise + boost wind streaks) plus optional GTAO ambient occlusion.

export const DEFAULT_POST_PARAMS = {
  enabled: true,
  aoEnabled: false,
  aoIntensity: 1.5,
  aoRadius: 2,
  // Scales the AO kernel with on-screen size instead of a fixed world-space
  // distance (helps when object scales vary wildly).
  aoScreenSpaceRadius: false,
  exposure: 1,
  contrast: 1,
  brightness: 0,
  saturation: 1.1,
  vignetteStrength: 1,
  vignetteRadius: 0.24,
  noiseAmount: 0,
  chromaticAberration: 0.0014,
  windLinesStrength: 0.35,
  windLinesMinSpeedKmh: 110,
}

// Values the color grade eases toward while boosting (blended by boostBlend).
export const BOOST_POST_PARAMS = {
  vignetteStrength: 1.35,
  chromaticAberration: 0.012,
}

function buildColorGradeShader(params) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      time: { value: 0 },
      contrast: { value: params.contrast },
      brightness: { value: params.brightness },
      saturation: { value: params.saturation },
      vignetteStrength: { value: params.vignetteStrength },
      vignetteRadius: { value: params.vignetteRadius },
      noiseAmount: { value: params.noiseAmount },
      chromaticAberration: { value: params.chromaticAberration },
      windLines: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float time;
      uniform float contrast;
      uniform float brightness;
      uniform float saturation;
      uniform float vignetteStrength;
      uniform float vignetteRadius;
      uniform float noiseAmount;
      uniform float chromaticAberration;
      uniform float windLines;
      varying vec2 vUv;

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233)) + time) * 43758.5453123);
      }

      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      // Thin radial streaks near the screen edges, racing toward the center.
      float windStreaks(vec2 uv) {
        vec2 dir = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
        float radius = length(dir);
        float angle = atan(dir.y, dir.x);

        const float LINE_COUNT = 90.0;
        float slot = angle / 6.2831853 * LINE_COUNT;
        float bin = floor(slot);

        float seed = hash(bin * 7.13 + floor(time * 9.0) * 131.7);
        float streakOn = step(0.82, seed);

        float linePos = abs(fract(slot) - 0.5);
        float lineMask = smoothstep(0.10, 0.02, linePos);

        float lifetime = fract(time * 9.0);
        float head = mix(0.42, 1.05, lifetime * (0.5 + 0.5 * hash(bin * 3.7)));
        float trail = smoothstep(head - 0.28, head - 0.05, radius) * smoothstep(head + 0.08, head, radius);

        float edgeMask = smoothstep(0.38, 0.75, radius);

        return streakOn * lineMask * trail * edgeMask;
      }

      void main() {
        vec2 center = vec2(0.5);
        vec2 direction = vUv - center;
        vec2 aberrationOffset = direction * chromaticAberration;

        vec4 color = texture2D(tDiffuse, vUv);
        color.r = texture2D(tDiffuse, vUv + aberrationOffset).r;
        color.b = texture2D(tDiffuse, vUv - aberrationOffset).b;

        color.rgb += brightness;
        color.rgb = (color.rgb - 0.5) * contrast + 0.5;

        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(vec3(luminance), color.rgb, saturation);

        float dist = distance(vUv, center);
        float vignette = smoothstep(vignetteRadius, 0.98, dist);
        color.rgb *= 1.0 - vignette * vignetteStrength;

        float noise = random(vUv * resolution) - 0.5;
        color.rgb += noise * noiseAmount;

        if (windLines > 0.001) {
          color.rgb += windStreaks(vUv) * windLines;
        }

        gl_FragColor = vec4(color.rgb, color.a);
      }
    `,
  }
}

/**
 * Wire the composer chain onto an existing renderer/scene/camera.
 * `params` is the caller's live post-params object (mutated by its GUI).
 * Returns handles the caller drives from its own frame loop.
 */
export function createPostProcessing(renderer, scene, camera, params) {
  renderer.toneMappingExposure = params.exposure

  const composer = new EffectComposer(renderer)
  // 4x MSAA for the chain — without this the composer renders into
  // non-multisampled buffers and all geometry edges alias.
  composer.renderTarget1.samples = 4
  composer.renderTarget2.samples = 4

  const renderPass = new RenderPass(scene, camera)
  const gtaoPass = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight)
  gtaoPass.output = GTAOPass.OUTPUT.Default
  const colorGradePass = new ShaderPass(buildColorGradeShader(params))
  const outputPass = new OutputPass()

  composer.addPass(renderPass)
  composer.addPass(gtaoPass)
  composer.addPass(colorGradePass)
  composer.addPass(outputPass)

  // boostBlend (0..1) eases the vignette/aberration toward BOOST_POST_PARAMS.
  function applyPostParams(boostBlend = 0) {
    const boostedVignette = THREE.MathUtils.lerp(
      params.vignetteStrength,
      BOOST_POST_PARAMS.vignetteStrength,
      boostBlend
    )
    const boostedChromatic = THREE.MathUtils.lerp(
      params.chromaticAberration,
      BOOST_POST_PARAMS.chromaticAberration,
      boostBlend
    )

    renderer.toneMappingExposure = params.exposure
    gtaoPass.enabled = params.enabled && params.aoEnabled
    gtaoPass.blendIntensity = params.aoIntensity
    gtaoPass.updateGtaoMaterial({
      radius: params.aoRadius,
      screenSpaceRadius: params.aoScreenSpaceRadius,
    })
    colorGradePass.enabled = params.enabled
    colorGradePass.uniforms.contrast.value = params.contrast
    colorGradePass.uniforms.brightness.value = params.brightness
    colorGradePass.uniforms.saturation.value = params.saturation
    colorGradePass.uniforms.vignetteStrength.value = boostedVignette
    colorGradePass.uniforms.vignetteRadius.value = params.vignetteRadius
    colorGradePass.uniforms.noiseAmount.value = params.noiseAmount
    colorGradePass.uniforms.chromaticAberration.value = boostedChromatic
  }

  function setSize(width, height) {
    composer.setSize(width, height)
    colorGradePass.uniforms.resolution.value.set(width, height)
  }

  applyPostParams()

  return { composer, colorGradePass, gtaoPass, applyPostParams, setSize }
}
