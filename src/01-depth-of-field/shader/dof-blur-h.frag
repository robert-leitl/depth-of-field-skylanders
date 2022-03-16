#version 300 es

precision highp float;

uniform sampler2D u_packedTexture;
uniform int u_maxCoCRadius;
uniform float u_radiusScale;

in vec2 v_uv;

layout(location = 0) out vec4 outMidFarColor;
layout(location = 1) out vec4 outNearColor;

#pragma glslify: blur = require(./dof-blur.glsl)

void main() {
    blur(
        true,
        v_uv,
        u_maxCoCRadius,
        u_radiusScale,
        u_packedTexture,
        u_packedTexture, // not used in horizontal pass
        outMidFarColor,
        outNearColor
    );
}