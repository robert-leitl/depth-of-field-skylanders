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
    const int PASS_RESULT       = 0;
    const int PASS_COC          = 1;
    
    vec4 packedColor = texture(u_packedTexture, v_uv);
    vec4 midFarBlurColor = texture(u_midFarBlurTexture, v_uv);
    vec4 nearBlurTexture = texture(u_nearBlurTexture, v_uv);

    switch(u_passIndex) {
        case PASS_COC:
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
        default:
            compositeColor = packedColor;
    }
}