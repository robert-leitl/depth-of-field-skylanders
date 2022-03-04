#version 300 es

precision highp float;

uniform float u_deltaTime;

in vec3 v_normal;
in vec2 v_uv;

out vec4 outColor;

void main() {
    vec3 n = normalize(v_normal);
    outColor = vec4(v_normal, 1.) + vec4(v_uv, 0.5, 0.5);
}
