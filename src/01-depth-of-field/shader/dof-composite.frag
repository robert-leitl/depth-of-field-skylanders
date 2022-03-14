#version 300 es

precision highp float;

uniform sampler2D u_packedTexture;
uniform sampler2D u_midFarBlurTexture;
uniform sampler2D u_nearBlurTexture;
uniform int u_passIndex;

in vec2 v_uv;

out vec4 compositeColor;

float grayscale(vec3 c) {
    return (c.r + c.g + c.b) / 3.0;
}

void main() {
    const int COMPOSITE_RESULT       = 0;
    const int COMPOSITE_REGIONS      = 1;
    const int COMPOSITE_NEAR_FIELD   = 2;
    const int COMPOSITE_FAR_FIELD    = 3;
    
    vec4 packedColor = texture(u_packedTexture, v_uv);
    vec4 midFarBlurColor = texture(u_midFarBlurTexture, v_uv);
    vec4 nearBlurColor = texture(u_nearBlurTexture, v_uv);

    // find the normalized CoC
    vec2 texelSize = 1. / vec2(textureSize(u_packedTexture, 0)); 
    float normCoCRadius = (packedColor.a * 2. - 1.);

    // boost the coverage of near field
    float nearCoverageBoost = 3.5;
    float a = clamp(0., 1., nearCoverageBoost * nearBlurColor.a);
    nearBlurColor.rgb = nearBlurColor.rgb * (a / max(nearBlurColor.a, 0.001));
    nearBlurColor.a = a;

    // increase influence of the near field
    if (normCoCRadius > 0.1) {
        normCoCRadius = min(normCoCRadius * 1.8, 1.0);
    }

    // mix the blurred near and mid/far with the original image
    compositeColor = mix(packedColor, midFarBlurColor, abs(normCoCRadius)) * (1. - nearBlurColor.a) + vec4(nearBlurColor.rgb, 1.);

    switch(u_passIndex) {
        case COMPOSITE_REGIONS:
            float radius = packedColor.a;
            float gray = grayscale(packedColor.rgb);
            vec3 midColor = vec3(.3) * gray;
            compositeColor = vec4(1.);

            if (radius > 0.51) {
                // near field
                float strength = (radius - 0.5) * 2.;
                compositeColor.rgb = strength * vec3(0.0, 0.5, 1.) * vec3(gray) + (1. - strength) * midColor;
            } else if (radius >= 0.49) {
                // mid field
                compositeColor.rgb = midColor;
            } else {
                // far field
                float strength = (.5 - radius) * 2.;
                compositeColor.rgb = strength * vec3(1.0, 0.1, 0.1) * vec3(gray) + (1. - strength) * midColor;
            }
            break;
        case COMPOSITE_NEAR_FIELD:
            compositeColor = nearBlurColor;
            break;
        case COMPOSITE_FAR_FIELD:
            compositeColor = midFarBlurColor;
            break;
        default:
            compositeColor = compositeColor;
    }
}