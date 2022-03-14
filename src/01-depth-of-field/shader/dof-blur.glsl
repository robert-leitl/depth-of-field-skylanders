bool inNearField(float radiusPixels) {
    return radiusPixels > 0.25;
}

void depthOfFieldBlur(
    in bool isHorizontal,
    in vec2 A,
    in int maxCoCRadius,
    in sampler2D midFarInTexture,
    in sampler2D nearInTexture,
    out vec4 midFarOut,
    out vec4 nearOut
) {
    // the resulting g-buffer values
    vec4 midFarResult = vec4(0.);
    vec4 nearResult = vec4(0.);

    const int GAUSSIAN_TAPS = 6;
    float gaussian[GAUSSIAN_TAPS + 1];  
    // gaussian weights
    gaussian[6] = 0.00000000000000;
    gaussian[5] = 0.04153263993208;
    gaussian[4] = 0.06352050813141;
    gaussian[3] = 0.08822292796029;
    gaussian[2] = 0.11143948794984;
    gaussian[1] = 0.12815541114232;
    gaussian[0] = 0.13425804976814;

    // position of the current pixel
    vec2 texelSize = 1. / vec2(textureSize(midFarInTexture, 0));
    vec4 packedA = texture(midFarInTexture, A);
    float radiusA = (packedA.a * 2. - 1.);
    float rA = radiusA * float(maxCoCRadius);

    float midFarWeightSum = 0.;
    float nearWeightSum = 0.;

    // rapidly goes to 1 when within the near field
    float nearFieldnessA = clamp(radiusA * 3.0, 0., 1.);

    vec2 direction = vec2(float(isHorizontal), float(!isHorizontal));

    // the blur renders with half of the full resolution (see DOF_TEXTURE_SCALE in app)
    // this has to be compensated during the blur
    texelSize /= float(!isHorizontal) + 1.;

    // scatter as you gather loop
    for(int delta = -maxCoCRadius; delta <= maxCoCRadius; ++delta) {

        // get the CoC radius at this tap
        vec2 B = A + direction * (float(delta) * texelSize);
        vec4 packedB = texture(midFarInTexture, B);
        float rB = (packedB.a * 2. - 1.) * float(maxCoCRadius);

        ///////////////////////////////////////////////////// Mid/Far Field

        // mid/far field: B nearer then A weight
        float midFarBNearerWeight = clamp(abs(rA) - abs(rB) + 1.5, 0., 1.);

        // get the effect of the CoC at B on the current pixel at A
        float gaussianWeight = gaussian[clamp(int(float(abs(delta) * (GAUSSIAN_TAPS - 1)) / (0.001 + abs(rB * 0.5))), 0, GAUSSIAN_TAPS)];

        // get the weight for mid and far field values
        float midFarWeight = float(!inNearField(rB)) * midFarBNearerWeight * gaussianWeight;

        // also blur the near field of the mid far color for composition
        midFarWeight = mix(midFarWeight, 1., nearFieldnessA);

        // update the mid/far result
        midFarWeightSum += midFarWeight;
        midFarResult.rgb += packedB.rgb * midFarWeight;

        ///////////////////////////////////////////////////// Near Field

        // the near field value at this tap
        vec4 near;

        if (isHorizontal) {
            // the current tap contributes to the near field coverage
            float hasNearFieldCoverage = float(abs(float(delta)) <= rB);

            // rapidly move the coverage when tap contributes to the current pixel in near field
            near.a = hasNearFieldCoverage * clamp((rB / float(maxCoCRadius)) * 4., 0., 1.);
            near.a *= near.a;
            near.a *= near.a;

            // premultiplied color
            near.rgb = packedB.rgb * near.a;
        } else {
            near = texture(nearInTexture, B);
        }

        // simple box blur for the near field
        float nearWeight = 1.;
        nearResult += near * nearWeight;
        nearWeightSum += 1.;
    }

    // forward the normalized CoC to the next pass
    midFarResult.a = packedA.a;

    // apply total weights
    midFarResult.rgb /= midFarWeightSum;
    nearResult /= nearWeightSum;

    nearOut = nearResult;
    midFarOut = midFarResult;
}

#pragma glslify: export(depthOfFieldBlur)