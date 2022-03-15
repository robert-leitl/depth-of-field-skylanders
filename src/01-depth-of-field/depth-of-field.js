
import * as twgl from 'twgl.js';

import drawVertShaderSource from './shader/draw.vert';
import drawFragShaderSource from './shader/draw.frag';
import dofPackVertShaderSource from './shader/dof-pack.vert';
import dofPackFragShaderSource from './shader/dof-pack.frag';
import dofBlurHVertShaderSource from './shader/dof-blur-h.vert';
import dofBlurHFragShaderSource from './shader/dof-blur-h.frag';
import dofBlurVVertShaderSource from './shader/dof-blur-v.vert';
import dofBlurVFragShaderSource from './shader/dof-blur-v.frag';
import dofCompositeVertShaderSource from './shader/dof-composite.vert';
import dofCompositeFragShaderSource from './shader/dof-composite.frag';

export class DepthOfField {
    oninit;

    #time = 0;
    #frames = 0;
    #deltaTime = 0;
    #isDestroyed = false;

    enableRegionsPreview = false;
    enableFarMidPreview = false;
    enableNearPreview = false;
    enablePackedPreview = false;
    enableCoCPreview = false;
    passPreviewSize = 1;

    DOF_TEXTURE_SCALE = .5;

    COMPOSITE_RESULT = 0;
    COMPOSITE_REGIONS = 1;
    COMPOSITE_NEAR_FIELD = 2;
    COMPOSITE_FAR_FIELD = 3;
    COMPOSITE_PACKED = 4;
    COMPOSITE_COC = 5;

    camera = {
        rotation: [0, 0, 0],
        position: [0, 0, 150],
        matrix: twgl.m4.identity(),
        near: 1,
        far: 500
    };

    dof = {
        nearBlurry: 40,
        nearSharp: 110,
        farSharp: 200,
        farBlurry: 280,
        maxCoCRadius: 15
    };

    instances = [];

    constructor(canvas, pane, oninit = null) {
        this.canvas = canvas;
        this.pane = pane;
        this.oninit = oninit;

        this.#init();
    }

    resize() {
        const gl = this.gl;

        twgl.resizeCanvasToDisplaySize(gl.canvas);
        
        // When you need to set the viewport to match the size of the canvas's
        // drawingBuffer this will always be correct
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        this.#resizeTextures(gl);

        this.#updateProjectionMatrix(gl);
    }

    run(time = 0) {
        this.#deltaTime = time - this.#time;
        this.#time = time;
        this.#frames += this.#deltaTime / 16;

        if (this.#isDestroyed) return;

        this.#updateCameraOrbit();

        this.drawUniforms.u_deltaTime = this.#deltaTime;
        this.drawUniforms.u_worldInverseTransposeMatrix = twgl.m4.transpose(twgl.m4.inverse(this.drawUniforms.u_worldMatrix));

        this.instanceMatrices.forEach((mat, ndx) => {
            const instance = this.instances[ndx];
            const m = twgl.m4.identity();
            twgl.m4.translate(m, instance.translation, m);
            twgl.m4.rotateX(m, instance.rotation[0] + this.#frames * instance.rotationSpeed * .5, m);
            twgl.m4.rotateY(m, instance.rotation[1] + this.#frames * instance.rotationSpeed, m);
            twgl.m4.rotateZ(m, instance.rotation[2], m);
            twgl.m4.scale(m, instance.scale, mat);
            
        });

        this.#render();

        requestAnimationFrame((t) => this.run(t));
    }

    #render() {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);

        // draw depth and color 
        this.#setFramebuffer(gl, this.drawFramebuffer, this.drawFramebufferWidth, this.drawFramebufferHeight);

        // draw the instances
        gl.useProgram(this.drawProgram);
        gl.bindVertexArray(this.objectVAO);
        // upload the instance matrix buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceMatricesArray);
        gl.uniformMatrix4fv(this.drawLocations.u_worldMatrix, false, this.drawUniforms.u_worldMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_viewMatrix, false, this.drawUniforms.u_viewMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_projectionMatrix, false, this.drawUniforms.u_projectionMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_worldInverseTransposeMatrix, false, this.drawUniforms.u_worldInverseTransposeMatrix);
        gl.uniform3f(this.drawLocations.u_cameraPosition, this.camera.position[0], this.camera.position[1], this.camera.position[2]);
        gl.uniform1i(this.drawLocations.u_envMap, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.envMapTexture);
        gl.clearBufferfv(gl.COLOR, 0, [1.0, 0.4, 0.6, 0.]);
        gl.clearBufferfv(gl.DEPTH, 0, [1.]);
        gl.drawElementsInstanced(
            gl.TRIANGLES,
            this.objectBuffers.numElements,
            gl.UNSIGNED_SHORT,
            0,
            this.numInstances
        )
        this.#setFramebuffer(gl, null, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // blit depth and color
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.drawFramebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.blitFramebuffer);
        gl.clearBufferfv(gl.COLOR, 0, [0.0, 0.0, 0.0, 1.0]);
        gl.clearBufferfv(gl.DEPTH, 0, [0]);
        gl.blitFramebuffer(0, 0, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, 0, this.drawFramebufferWidth, this.drawFramebufferHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.blitFramebuffer(0, 0, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, 0, this.drawFramebufferWidth, this.drawFramebufferHeight, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        this.#setFramebuffer(gl, null, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // pack color and CoC pass
        this.#renderDofPass(
            this.dofPackedFramebuffer, 
            this.drawFramebufferWidth, this.drawFramebufferHeight, 
            this.dofPackProgram,
            [
                [this.dofPackLocations.u_depth, this.depthTexture],
                [this.dofPackLocations.u_color, this.colorTexture]
            ],
            [
                [this.dofPackLocations.u_nearBlurry, this.dof.nearBlurry],
                [this.dofPackLocations.u_nearSharp, this.dof.nearSharp],
                [this.dofPackLocations.u_farBlurry, this.dof.farBlurry],
                [this.dofPackLocations.u_farSharp, this.dof.farSharp],
                [this.dofPackLocations.u_zNear, this.camera.near],
                [this.dofPackLocations.u_zFar, this.camera.far]
            ]
        );

        // blur horizontal pass
        this.#renderDofPass(
            this.dofBlurHFramebuffer, 
            this.dofFramebufferWidth, this.dofFramebufferHeight, 
            this.dofBlurHProgram,
            [
                [this.dofBlurHLocations.u_packedTexture, this.dofPackedTexture]
            ],
            [],
            [
                [this.dofBlurHLocations.u_maxCoCRadius, this.dof.maxCoCRadius]
            ]
        );

        // blur vertical pass
        this.#renderDofPass(
            this.dofBlurVFramebuffer, 
            this.dofFramebufferWidth, this.dofFramebufferHeight, 
            this.dofBlurVProgram,
            [
                [this.dofBlurVLocations.u_midFarBlurTexture, this.dofBlurHMidFarTexture],
                [this.dofBlurVLocations.u_nearBlurTexture, this.dofBlurHNearTexture]
            ],
            [],
            [
                [this.dofBlurVLocations.u_maxCoCRadius, this.dof.maxCoCRadius]
            ]
        );

        // render the composite to the draw framebuffer
        this.#renderComposite(this.COMPOSITE_RESULT);

        
        // draw the pass overlays
        let previewY = 0;
        if (this.enableRegionsPreview)
            previewY = this.#renderPassPreview(0, this.COMPOSITE_REGIONS);
        if (this.enableFarMidPreview)
            previewY = this.#renderPassPreview(previewY, this.COMPOSITE_FAR_FIELD);
        if (this.enableNearPreview)
            previewY = this.#renderPassPreview(previewY, this.COMPOSITE_NEAR_FIELD);
        if (this.enablePackedPreview)
            previewY = this.#renderPassPreview(previewY, this.COMPOSITE_PACKED);
        if (this.enableCoCPreview)
            previewY = this.#renderPassPreview(previewY, this.COMPOSITE_COC);
    }

    #renderDofPass(fbo, w, h, program, locTex, locFloat = [], locInt = []) {
         /** @type {WebGLRenderingContext} */
         const gl = this.gl;

        this.#setFramebuffer(gl, fbo, w, h);
        gl.useProgram(program);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.bindVertexArray(this.quadVAO);

        locTex.forEach(([loc, texture], ndx) => {
            gl.uniform1i(loc, ndx);
            gl.activeTexture(gl[`TEXTURE${ndx}`]);
            gl.bindTexture(gl.TEXTURE_2D, texture);
        });

        locFloat.forEach(([loc, value]) => {
            gl.uniform1f(loc, value);
        });

        locInt.forEach(([loc, value]) => {
            gl.uniform1i(loc, value);
        });

        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(gl, null, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    #renderPassPreview(y = 0, passIndex = 0) {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        const w = gl.canvas.width * this.passPreviewSize;
        const h = gl.canvas.height * this.passPreviewSize;

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y, w, h);
        gl.viewport(0, y, w, h);
        this.#renderComposite(passIndex);
        gl.disable(gl.SCISSOR_TEST);

        return y + h;
    }

    #renderComposite(passIndex = 0) {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.dofCompositeProgram);
        gl.bindVertexArray(this.quadVAO);

        gl.uniform1i(this.dofCompositeLocations.u_packedTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dofPackedTexture);

        gl.uniform1i(this.dofCompositeLocations.u_midFarBlurTexture, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVMidFarTexture);

        gl.uniform1i(this.dofCompositeLocations.u_nearBlurTexture, 2);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVNearTexture);

        gl.uniform1i(this.dofCompositeLocations.u_sourceColorTexture, 3);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);

        gl.uniform1i(this.dofCompositeLocations.u_passIndex, passIndex);
        
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);
    }

    destroy() {
        this.#isDestroyed = true;
    }

    #init() {
        /** @type {WebGLRenderingContext} */
        this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false });
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;
        if (!gl) {
            throw new Error('No WebGL 2 context!')
        }

        ///////////////////////////////////  PROGRAM SETUP

        // setup programs
        this.drawProgram = this.#createProgram(gl, [drawVertShaderSource, drawFragShaderSource]);
        this.dofPackProgram = this.#createProgram(gl, [dofPackVertShaderSource, dofPackFragShaderSource], null, {a_position: 0, a_uv: 1});
        this.dofBlurHProgram = this.#createProgram(gl, [dofBlurHVertShaderSource, dofBlurHFragShaderSource], null, {a_position: 0, a_uv: 1});
        this.dofBlurVProgram = this.#createProgram(gl, [dofBlurVVertShaderSource, dofBlurVFragShaderSource], null, {a_position: 0, a_uv: 1});
        this.dofCompositeProgram = this.#createProgram(gl, [dofCompositeVertShaderSource, dofCompositeFragShaderSource], null, {a_position: 0, a_uv: 1});

        // find the locations
        this.drawLocations = {
            a_position: gl.getAttribLocation(this.drawProgram, 'a_position'),
            a_normal: gl.getAttribLocation(this.drawProgram, 'a_normal'),
            a_uv: gl.getAttribLocation(this.drawProgram, 'a_uv'),
            a_instanceMatrix: gl.getAttribLocation(this.drawProgram, 'a_instanceMatrix'),
            u_worldMatrix: gl.getUniformLocation(this.drawProgram, 'u_worldMatrix'),
            u_viewMatrix: gl.getUniformLocation(this.drawProgram, 'u_viewMatrix'),
            u_projectionMatrix: gl.getUniformLocation(this.drawProgram, 'u_projectionMatrix'),
            u_worldInverseTransposeMatrix: gl.getUniformLocation(this.drawProgram, 'u_worldInverseTransposeMatrix'),
            u_envMap: gl.getUniformLocation(this.drawProgram, 'u_envMap'),
            u_cameraPosition: gl.getUniformLocation(this.drawProgram, 'u_cameraPosition')
        };
        this.dofPackLocations = {
            a_position: gl.getAttribLocation(this.dofPackProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofPackProgram, 'a_uv'),
            u_depth: gl.getUniformLocation(this.dofPackProgram, 'u_depth'),
            u_color: gl.getUniformLocation(this.dofPackProgram, 'u_color'),
            u_nearBlurry: gl.getUniformLocation(this.dofPackProgram, 'u_nearBlurry'),
            u_nearSharp: gl.getUniformLocation(this.dofPackProgram, 'u_nearSharp'),
            u_farBlurry: gl.getUniformLocation(this.dofPackProgram, 'u_farBlurry'),
            u_farSharp: gl.getUniformLocation(this.dofPackProgram, 'u_farSharp'),
            u_zNear: gl.getUniformLocation(this.dofPackProgram, 'u_zNear'),
            u_zFar: gl.getUniformLocation(this.dofPackProgram, 'u_zFar')
        };
        this.dofBlurHLocations = {
            a_position: gl.getAttribLocation(this.dofBlurHProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofBlurHProgram, 'a_uv'),
            u_packedTexture: gl.getUniformLocation(this.dofBlurHProgram, 'u_packedTexture'),
            u_maxCoCRadius: gl.getUniformLocation(this.dofBlurHProgram, 'u_maxCoCRadius'),
        };
        this.dofBlurVLocations = {
            a_position: gl.getAttribLocation(this.dofBlurVProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofBlurVProgram, 'a_uv'),
            u_midFarBlurTexture: gl.getUniformLocation(this.dofBlurVProgram, 'u_midFarBlurTexture'),
            u_nearBlurTexture: gl.getUniformLocation(this.dofBlurVProgram, 'u_nearBlurTexture'),
            u_maxCoCRadius: gl.getUniformLocation(this.dofBlurVProgram, 'u_maxCoCRadius'),
        };
        this.dofCompositeLocations = {
            a_position: gl.getAttribLocation(this.dofCompositeProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofCompositeProgram, 'a_uv'),
            u_packedTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_packedTexture'),
            u_midFarBlurTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_midFarBlurTexture'),
            u_nearBlurTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_nearBlurTexture'),
            u_passIndex: gl.getUniformLocation(this.dofCompositeProgram, 'u_passIndex'),
            u_sourceColorTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_sourceColorTexture')
        };

        // setup uniforms
        this.drawUniforms = {
            u_worldMatrix: twgl.m4.translate(twgl.m4.scaling([13, 13, 13]), [0, 0, 0]),
            u_viewMatrix: twgl.m4.identity(),
            u_projectionMatrix: twgl.m4.identity(),
            u_worldInverseTransposeMatrix: twgl.m4.identity()
        };

        /////////////////////////////////// GEOMETRY / MESH SETUP

        // create object VAO
        this.objectBuffers = twgl.primitives.createTorusBuffers(gl, .8, 0.25, 32, 32);
        this.objectVAO = this.#makeVertexArray(gl, [
            [this.objectBuffers.position, this.drawLocations.a_position, 3],
            [this.objectBuffers.normal, this.drawLocations.a_normal, 3],
            [this.objectBuffers.texcoord, this.drawLocations.a_uv, 2],
        ], this.objectBuffers.indices);

        // create quad VAO
        this.quadBuffers = twgl.primitives.createXYQuadBuffers(gl);
        this.quadVAO = this.#makeVertexArray(gl, [
            [this.quadBuffers.position, this.dofPackLocations.a_position, 2],
            [this.quadBuffers.texcoord, this.dofPackLocations.a_uv, 2]
        ], this.quadBuffers.indices);


        // instances setup
        gl.bindVertexArray(this.objectVAO);
        this.gridSize = 5;
        this.numInstances = this.gridSize * this.gridSize * this.gridSize;
        this.instanceMatricesArray = new Float32Array(this.numInstances * 16);
        this.instanceMatrices = [];
        const layerCount = this.gridSize * this.gridSize;
        const spacing = 82;
        const offset = Math.floor(this.gridSize / 2);
        const spacingOffset = spacing / 1.5;
        for(let i=0; i<this.numInstances; ++i) {
            const x = i % this.gridSize - offset;
            const z = Math.floor(i / layerCount) - offset;
            const y = Math.floor((i % layerCount) / this.gridSize) - offset;
            const instanceMatrix = twgl.m4.translation([x * spacing, y * spacing, z * spacing]);
            const instanceMatrixArray = new Float32Array(this.instanceMatricesArray.buffer, i * 16 * 4, 16);
            instanceMatrixArray.set(instanceMatrix);
            this.instanceMatrices.push(instanceMatrixArray);

            const scale = (Math.random() + 0.5) * 3.;
            this.instances.push({
                translation: [
                    x * spacing + (Math.random() * spacingOffset - spacingOffset / 2),
                    y * spacing + (Math.random() * spacingOffset - spacingOffset / 2),
                    z * spacing + (Math.random() * spacingOffset - spacingOffset / 2)
                ],
                scale: [scale, scale, scale],
                rotation: [
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2
                ],
                rotationSpeed: (Math.random() * 2 - 1) * 0.01
            });
        }
        this.matrixBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceMatricesArray.byteLength, gl.DYNAMIC_DRAW);
        const mat4AttribSlotCount = 4;
        const bytesPerMatrix = 16 * 4;
        for(let j=0; j<mat4AttribSlotCount; ++j) {
            const loc = this.drawLocations.a_instanceMatrix + j;
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(
                loc,
                4,
                gl.FLOAT,
                false,
                bytesPerMatrix, // stride, num bytes to advance to get to next set of values
                j * 4 * 4 // one row = 4 values each 4 bytes
            );
            gl.vertexAttribDivisor(loc, 1); // it sets this attribute to only advance to the next value once per instance
        }
        gl.bindVertexArray(null);

        // initial client dimensions
        const clientWidth = gl.canvas.clientWidth;
        const clientHeight = gl.canvas.clientHeight;

         
        /////////////////////////////////// INITIAL DRAW PASS SETUP

        this.drawFramebufferWidth = clientWidth;
        this.drawFramebufferHeight = clientHeight;

        // the initial draw pass renders the scene using multisample renderbuffers for
        // color and depth which are then blitted to separate textures

        // draw framebuffer setup
        this.drawFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFramebuffer);
        // depth render buffer setup
        this.depthRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, this.drawFramebufferWidth, this.drawFramebufferHeight);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        // color renderbuffer setup
        this.colorRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, gl.getParameter(gl.MAX_SAMPLES), gl.RGBA8, this.drawFramebufferWidth, this.drawFramebufferHeight);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRenderbuffer);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete render framebuffer setup')
        }

        // blit framebuffer setup
        this.blitFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blitFramebuffer);
        // depth texture setup
        this.depthTexture = this.#createAndSetupTexture(gl, gl.NEAREST, gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(this. gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);   
        // color texture setup
        this.colorTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete render framebuffer setup')
        }

        /////////////////////////////////// DOF PACK COLOR AND COC PASS SETUP

        this.dofPackedTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.dofPackedTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.dofPackedFramebuffer = this.#createFramebuffer(gl, [this.dofPackedTexture]);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete dof pack framebuffer setup')
        }

        /////////////////////////////////// DOF BLUR HORIZONTAL PASS SETUP

        this.dofFramebufferWidth = clientWidth * this.DOF_TEXTURE_SCALE;
        this.dofFramebufferHeight = clientHeight * this.DOF_TEXTURE_SCALE;

        this.dofBlurHMidFarTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurHMidFarTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.dofBlurHNearTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurHNearTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.dofBlurHFramebuffer = this.#createFramebuffer(gl, [this.dofBlurHMidFarTexture, this.dofBlurHNearTexture]);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete dof blur horizontal framebuffer setup')
        }

        /////////////////////////////////// DOF BLUR VERTICAL PASS SETUP

        this.dofBlurVMidFarTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVMidFarTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.dofBlurVNearTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVNearTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.dofBlurVFramebuffer = this.#createFramebuffer(gl, [this.dofBlurVMidFarTexture, this.dofBlurVNearTexture]);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete blur vertical framebuffer setup')
        }

        this.resize();

        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.initEnvMap();
        this.#initOrbitControls();
        this.#initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    initEnvMap() {
        const gl = this.gl;

        this.envMapTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.envMapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2000, 1000, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        const img = new Image();
        img.src = new URL('../assets/studio017.jpg', import.meta.url);
        img.addEventListener('load', () => {
            gl.bindTexture(gl.TEXTURE_2D, this.envMapTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2000, 1000, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
        });
    }

    #initOrbitControls() {
        this.pointerDown = false;
        this.pointerDownPos = { x: 0, y: 0 };
        this.pointerPos = { x: 0, y: 0 };
        this.pointerFollowPos = { x: 0, y: 0 };

        this.canvas.addEventListener('pointerdown', e => {
            this.pointerDownPos = { x: e.clientX, y: e.clientY }
            this.pointerFollowPos = { x: e.clientX, y: e.clientY }
            this.pointerPos = { x: e.clientX, y: e.clientY }
            this.pointerDownCameraPosition = [...this.camera.position];
            this.pointerDown = true;
        });
        this.canvas.addEventListener('pointerup', e => {
            this.pointerDown = false;
        });
        this.canvas.addEventListener('pointermove', e => {
            if (this.pointerDown) {
                this.pointerPos = { x: e.clientX, y: e.clientY }
            }
        });
    }

    #updateCameraOrbit() {
        if (this.pointerDown) {
            const damping = 3;
            const speed = 0.001;
            this.pointerFollowPos.x += (this.pointerPos.x - this.pointerFollowPos.x) / damping;
            this.pointerFollowPos.y += (this.pointerPos.y - this.pointerFollowPos.y) / damping;

            const rY = -(this.pointerFollowPos.x - this.pointerDownPos.x) * speed;
            const rX = -(this.pointerFollowPos.y - this.pointerDownPos.y) * speed;

            const mX = twgl.m4.axisRotate(twgl.m4.identity(), [1, 0, 0], rX);
            const m = twgl.m4.axisRotate(mX, [0, 1, 0], rY);
            this.camera.position = twgl.m4.transformPoint(m, this.pointerDownCameraPosition);
            this.#updateCameraMatrix();
        }
    }

    #createFramebuffer(gl, colorAttachements) {
        const fbo = gl.createFramebuffer();
        const drawBuffers = [];
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        colorAttachements.forEach((texture, ndx) => {
            const attachmentPoint = gl[`COLOR_ATTACHMENT${ndx}`];
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                attachmentPoint,
                gl.TEXTURE_2D, 
                texture,
                0);
            drawBuffers.push(attachmentPoint);
        });
        gl.drawBuffers(drawBuffers);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fbo;
    }

    #makeVertexArray(gl, bufLocNumElmPairs, indices) {
        const va = gl.createVertexArray();
        gl.bindVertexArray(va);
        for (const [buffer, loc, numElem] of bufLocNumElmPairs) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(
                loc,      // attribute location
                numElem,        // number of elements
                gl.FLOAT, // type of data
                false,    // normalize
                0,        // stride (0 = auto)
                0,        // offset
            );
        }
        if (indices) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
        }
        gl.bindVertexArray(null);
        return va;
    }

    #createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);

        if (success) {
            return shader;
        }

        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    #createProgram(gl, shaderSources, transformFeedbackVaryings, attribLocations) {
        const program = gl.createProgram();

        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, ndx) => {
            const shader = this.#createShader(gl, type, shaderSources[ndx]);
            gl.attachShader(program, shader);
        });

        if (transformFeedbackVaryings) {
            gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.SEPARATE_ATTRIBS);
        }

        if (attribLocations) {
            for(const attrib in attribLocations) {
                gl.bindAttribLocation(program, attribLocations[attrib], attrib);
            }
        }

        gl.linkProgram(program);
        const success = gl.getProgramParameter(program, gl.LINK_STATUS);

        if (success) {
            return program;
        }

        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    }

    #setFramebuffer(gl, fbo, width, height) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); // all draw commands will affect the framebuffer
        gl.viewport(0, 0, width, height);
    }

    #createAndSetupTexture(gl, minFilter, magFilter) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
        return texture;
    }

    #resizeTextures(gl) {
        const clientWidth = gl.canvas.clientWidth;
        const clientHeight = gl.canvas.clientHeight;
        this.drawFramebufferWidth = clientWidth;
        this.drawFramebufferHeight = clientHeight;
        this.dofFramebufferWidth = clientWidth * this.DOF_TEXTURE_SCALE;
        this.dofFramebufferHeight = clientHeight * this.DOF_TEXTURE_SCALE;

        // resize draw/blit textures and buffers
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight);
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, gl.getParameter(gl.MAX_SAMPLES), gl.RGBA8, clientWidth, clientHeight);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(this. gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, clientWidth, clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // resize dof packed texture
        gl.bindTexture(gl.TEXTURE_2D, this.dofPackedTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.drawFramebufferWidth, this.drawFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // resize dof blur textures
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurHNearTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurHMidFarTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVNearTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.dofBlurVMidFarTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.dofFramebufferWidth, this.dofFramebufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        
        // reset bindings
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    #updateCameraMatrix() {
        twgl.m4.lookAt(this.camera.position, [0, 0, 0], [0, 1, 0], this.camera.matrix);
        twgl.m4.inverse(this.camera.matrix, this.drawUniforms.u_viewMatrix);
    }

    #updateProjectionMatrix(gl) {
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        twgl.m4.perspective(Math.PI / 4, aspect, this.camera.near, this.camera.far, this.drawUniforms.u_projectionMatrix);
    }

    #initTweakpane() {
        if (this.pane) {
            const maxFar = 700;

            const cameraFolder = this.pane.addFolder({ title: 'Camera' });
            /*this.#createTweakpaneSlider(cameraFolder, this.camera.position, 0, 'x', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(cameraFolder, this.camera.position, 1, 'y', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(cameraFolder, this.camera.position, 2, 'z', 50, 200, 1, () => this.#updateCameraMatrix());*/
            this.#createTweakpaneSlider(cameraFolder, this.camera, 'near', 'near', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            this.#createTweakpaneSlider(cameraFolder, this.camera, 'far', 'far', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            const dofSettings = this.pane.addFolder({ title: 'DoF Settings' });
            this.#createTweakpaneSlider(dofSettings, this.dof, 'maxCoCRadius', 'radius', 0, 30, 1);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'nearBlurry', 'near blur', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'nearSharp', 'near sharp', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'farSharp', 'far sharp', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'farBlurry', 'far blur', 0, maxFar);
            const passViewsFolder = this.pane.addFolder({ title: 'Render Passes' });
            passViewsFolder.addInput(this, 'enableRegionsPreview', { label: 'regions' });
            passViewsFolder.addInput(this, 'enableFarMidPreview', { label: 'far/mid' });
            passViewsFolder.addInput(this, 'enableNearPreview', { label: 'near' });
            passViewsFolder.addInput(this, 'enablePackedPreview', { label: 'packed' });
            passViewsFolder.addInput(this, 'enableCoCPreview', { label: 'coc' });
            this.#createTweakpaneSlider(passViewsFolder, this, 'passPreviewSize', 'size', 0, 1);
        }
    }

    #createTweakpaneSlider(folder, obj, propName, label, min, max, stepSize = null, callback) {
        const slider = folder.addBlade({
            view: 'slider',
            label,
            min,
            max,
            step: stepSize,
            value: obj[propName],
        });
        slider.on('change', e => {
            obj[propName] = e.value;
            if(callback) callback();
        });
    }
}
