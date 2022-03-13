#version 300 es

precision highp float;

uniform sampler2D u_depth;
uniform sampler2D u_color;
uniform float u_nearBlurry;
uniform float u_nearSharp;
uniform float u_farBlurry;
uniform float u_farSharp;

in vec2 v_uv;

out vec4 packed;

void main() {
    float tmp = u_nearBlurry + u_nearSharp + u_farBlurry + u_farSharp;
    float CoC = texture(u_depth, v_uv).r * tmp;
    vec4 color = texture(u_color, v_uv);
    packed = vec4(color.rgb, CoC);
}
