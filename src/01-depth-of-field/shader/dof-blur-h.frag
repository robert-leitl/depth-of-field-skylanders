#version 300 es

precision highp float;

uniform sampler2D u_packedTexture;

in vec2 v_uv;

layout(location = 0) out vec4 outMidFarColor;
layout(location = 1) out vec4 outNearColor;

void main() {
    vec4 packedColor = texture(u_packedTexture, v_uv);
    vec4 nearBlurColor;

    outNearColor = packedColor;
    outMidFarColor = packedColor;
}