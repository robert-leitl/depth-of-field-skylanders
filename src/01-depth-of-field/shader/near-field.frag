#version 300 es

precision highp float;

uniform sampler2D u_depthTexture;
uniform sampler2D u_colorTexture;

in vec2 v_uv;

out vec4 outColor;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

void main() {
    float depth = texture(u_depthTexture, v_uv).r;
    float CoC = depth * 2. - 1.;
    float minCoC = -0.0;
    float maxCoC = 0.6;
    float alpha = map(clamp(CoC, minCoC, maxCoC), minCoC, maxCoC, 1., 0.);
    vec4 color = texture(u_colorTexture, v_uv);
    outColor = vec4(color.rgb * alpha, alpha);
}
