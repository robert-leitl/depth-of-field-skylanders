#version 300 es

precision highp float;

uniform sampler2D u_midFarBlurTexture;
uniform sampler2D u_nearBlurTexture;
uniform int u_maxCoCRadius;

in vec2 v_uv;

layout(location = 0) out vec4 outMidFarColor;
layout(location = 1) out vec4 outNearColor;

#pragma glslify: blur = require(./dof-blur.glsl)

void main() {
    blur(
        false,
        v_uv,
        u_maxCoCRadius,
        u_midFarBlurTexture,
        u_nearBlurTexture,
        outMidFarColor,
        outNearColor
    );
}