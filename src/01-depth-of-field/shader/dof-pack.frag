#version 300 es

precision highp float;

uniform sampler2D u_depth;
uniform sampler2D u_color;

in vec2 v_uv;

out vec4 packed;

void main() {
    packed = vec4(v_uv, 1., 1.);
}
