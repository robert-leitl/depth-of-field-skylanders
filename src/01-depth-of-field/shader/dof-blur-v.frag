#version 300 es

precision highp float;

uniform sampler2D u_midFarBlurTexture;
uniform sampler2D u_nearBlurTexture;

in vec2 v_uv;

layout(location = 0) out vec4 outMidFarColor;
layout(location = 1) out vec4 outNearColor;

void main() {
    vec4 midFarBlurColor = texture(u_midFarBlurTexture, v_uv);
    vec4 nearBlurColor = texture(u_nearBlurTexture, v_uv);

    outNearColor = nearBlurColor;
    outMidFarColor = midFarBlurColor;
}