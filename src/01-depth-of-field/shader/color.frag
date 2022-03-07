#version 300 es

precision highp float;

uniform sampler2D u_colorTexture;

in vec2 v_uv;

out vec4 outColor;

void main() {
    outColor = texture(u_colorTexture, v_uv);
}
