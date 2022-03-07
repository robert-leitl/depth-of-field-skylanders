#version 300 es

uniform mat4 u_worldMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_projectionMatrix;
uniform mat4 u_worldInverseTransposeMatrix;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in mat4 a_instanceMatrix;

out vec3 v_normal;
out vec2 v_uv;

void main() {
    v_uv = a_uv;
    v_normal = (a_instanceMatrix * u_worldInverseTransposeMatrix * vec4(a_normal, 0.)).xyz;
    gl_Position = u_projectionMatrix * u_viewMatrix * a_instanceMatrix * u_worldMatrix * vec4(a_position, 1.);
}
