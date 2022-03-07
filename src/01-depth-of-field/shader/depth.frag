#version 300 es

precision highp float;

uniform sampler2D u_depthTexture;
uniform sampler2D u_colorTexture;

in vec2 v_uv;

out vec4 outColor;

void main() {
    float depth = texture(u_depthTexture, v_uv).r;
    vec4 color = texture(u_colorTexture, v_uv);
    outColor = vec4(vec3(depth), 1.);
}
