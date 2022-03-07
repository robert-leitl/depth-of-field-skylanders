#version 300 es

precision highp float;

uniform sampler2D u_depthTexture;
uniform sampler2D u_colorTexture;
uniform sampler2D u_nearFieldTexture;
uniform sampler2D u_farFieldTexture;

in vec2 v_uv;

out vec4 outColor;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

void main() {
    float depth = texture(u_depthTexture, v_uv).r;
    float CoC = depth * 2. - 1.;
    float minCoC = 0.99;
    float maxCoC = 1.;
    float alpha = map(clamp(CoC, minCoC, maxCoC), minCoC, maxCoC, 0., 1.);

    vec4 nearFieldColor = texture(u_nearFieldTexture, v_uv);
    vec4 farFieldColor = texture(u_farFieldTexture, v_uv);
    vec4 color = mix(texture(u_colorTexture, v_uv), farFieldColor, alpha);
    outColor = nearFieldColor + color * (1. - nearFieldColor.a);
    //outColor = vec4(alpha);
}
