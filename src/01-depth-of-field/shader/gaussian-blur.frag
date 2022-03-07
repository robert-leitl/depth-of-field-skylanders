#version 300 es

precision highp float;

uniform sampler2D u_colorTexture;
uniform vec2 u_direction;

in vec2 v_uv;

out vec4 outColor;

vec4 blur13(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 off1 = vec2(1.411764705882353) * direction;
  vec2 off2 = vec2(3.2941176470588234) * direction;
  vec2 off3 = vec2(5.176470588235294) * direction;
  color += texture(image, uv) * 0.1964825501511404;
  color += texture(image, uv + (off1 / resolution)) * 0.2969069646728344;
  color += texture(image, uv - (off1 / resolution)) * 0.2969069646728344;
  color += texture(image, uv + (off2 / resolution)) * 0.09447039785044732;
  color += texture(image, uv - (off2 / resolution)) * 0.09447039785044732;
  color += texture(image, uv + (off3 / resolution)) * 0.010381362401148057;
  color += texture(image, uv - (off3 / resolution)) * 0.010381362401148057;
  return color;
}

vec4 boxBlur(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.);
  vec2 texelSize = 1. / resolution;
  int size = int(max(direction.x, direction.y));
  vec2 dir = normalize(direction);
  for(int i=-size; i<=size; ++i) {
    vec4 tex = texture(image, uv + texelSize * dir * float(i));
    color += tex;
  }
  color /= (float(size) * 2. + 1.);
  return color;
}

void main() {
    vec4 color = texture(u_colorTexture, v_uv);
    outColor = color;

    vec2 res = vec2(textureSize(u_colorTexture, 0));
    outColor = boxBlur(u_colorTexture, v_uv, res, u_direction);
}
