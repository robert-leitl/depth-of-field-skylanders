#version 300 es

precision highp float;

uniform sampler2D u_packedTexture;
uniform sampler2D u_midFarBlurTexture;
uniform sampler2D u_nearBlurTexture;
uniform int u_passIndex;

in vec2 v_uv;

out vec4 compositeColor;

void main() {
    const int PASS_RESULT       = 0;
    const int PASS_COC          = 1;
    
    vec4 packedColor = texture(u_packedTexture, v_uv);
    vec4 midFarBlurColor = texture(u_midFarBlurTexture, v_uv);
    vec4 nearBlurTexture = texture(u_nearBlurTexture, v_uv);

    switch(u_passIndex) {
        default:
            compositeColor = packedColor;
    }
}