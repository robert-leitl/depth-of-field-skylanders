#version 300 es

precision highp float;

uniform sampler2D u_colorTexture;

in vec2 v_uv;

out vec4 outColor;

// https://github.com/evanw/glfx.js/blob/master/src/filters/blur/lensblur.js
vec4 sample(vec2 delta) {
    /* randomize the lookup values to hide the fixed number of samples */
    float offset = random(vec3(delta, 151.7182), 0.0);
    
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (float t = 0.0; t <= 30.0; t++) {
        float percent = (t + offset) / 30.0;
        color += texture(u_colorTexture, v_uv + delta * percent);
        total += 1.0;
    }
    return color / total;
}

void main() {
    vec4 color = texture(u_colorTexture, v_uv);
    outColor = color;

    vec2 res = vec2(textureSize(u_colorTexture, 0));
    outColor = blur13(u_colorTexture, v_uv, res, u_direction);
}
