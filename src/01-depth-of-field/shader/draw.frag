#version 300 es

precision highp float;

uniform sampler2D u_envMap;
uniform float u_deltaTime;

flat in vec3 v_normal;
in vec2 v_uv;
in vec3 v_surfaceToView;

out vec4 outColor;

#define PI 3.1415926535

vec2 directionToEquirectangular(vec3 d) {
    vec2 p = vec2(0.);
    vec3 n = normalize(d);

    p.x = acos(n.y);

    d.y = 0.0;
    n = normalize(d);
    
    if(n.x >= 0.)
        p.y = acos(-n.z);
    else    
        p.y = acos(n.z) + PI;

    return p;
}

void main() {
    //vec3 r = reflect(normalize(v_surfaceToView), normalize(-v_normal));
    vec3 n = normalize(v_normal);
    vec3 v = normalize(v_surfaceToView);
    float nDv = dot(n, v);
    vec3 r = nDv * n * 2. - v;

    // Convert Cartesian direction vector to spherical coordinates.
	float phi   = atan(r.z, r.x);
	float theta = acos(r.y);
    vec2 equiPos = vec2(phi / (2. * PI), theta / PI);

	// Sample equirectangular texture.
    vec4 envMapColor = texture(u_envMap, equiPos);

    float fog = smoothstep(100., 400., length(v_surfaceToView));

    float fresnel = 1. - smoothstep(0.4, .7, nDv);

    outColor = envMapColor + (fog * vec4(1.0, 0.4, 0.6, 1.));
    outColor *= fresnel;
    outColor = clamp(vec4(0.), vec4(1.), pow(outColor, vec4(1.8)));
}
