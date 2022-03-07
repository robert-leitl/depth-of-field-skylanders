#version 300 es

precision highp float;

uniform float u_deltaTime;

in vec3 v_normal;
in vec2 v_uv;

out vec4 outColor;

void main() {
    vec3 n = normalize(v_normal);
    outColor = vec4(vec3(max(0., dot(n, vec3(0.6, 0.5, 0.5))) + 0.4) * vec3(1., 0.2, 0.6), 1.);
}
