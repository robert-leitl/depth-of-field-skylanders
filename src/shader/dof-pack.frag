#version 300 es

precision highp float;

uniform sampler2D u_depth;
uniform sampler2D u_color;
uniform float u_nearBlurry;
uniform float u_nearSharp;
uniform float u_farBlurry;
uniform float u_farSharp;
uniform float u_zNear;
uniform float u_zFar;

in vec2 v_uv;

out vec4 packed;

float zFromDepth(float depth, float zNear, float zFar) {
    float d = 2. * depth - 1.;
    return (2. * zNear * zFar) / (zFar + zNear - d * (zFar - zNear));
}

void main() {
    float tmp = u_nearBlurry + u_nearSharp + u_farBlurry + u_farSharp;

    vec4 color = texture(u_color, v_uv);

    // the non-linear depth value [0, 1]
    float depth = texture(u_depth, v_uv).x;

    // the reconstructed z-value in view space
    float z = zFromDepth(depth, u_zNear, u_zFar);

    // percent of the maximal CoC [1, -1]
    float radius = 1.;

    if (z < u_nearSharp) {
        radius = 1. - (max(z, u_nearBlurry) - u_nearBlurry) / (u_nearSharp - u_nearBlurry);
    } else if (z > u_farSharp) {
        radius = - (min(z, u_farBlurry) - u_farSharp) / (u_farBlurry - u_farSharp);
    } else {
        radius = 0.;
    }

    radius = radius * .5 + .5;

    packed = vec4(color.rgb, radius);
}
