#version 300 es

precision highp float;

uniform sampler2D u_depth;
uniform sampler2D u_color;

in vec2 v_uv;

out vec4 packed;

void main() {
    float CoC = texture(u_depth, v_uv).r;
    vec4 color = texture(u_color, v_uv);
    packed = vec4(color.rgb, CoC);
}
