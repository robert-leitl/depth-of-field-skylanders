
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

/*
Credits:
- https://casual-effects.blogspot.com/2013/09/the-skylanders-swap-force-depth-of.html
- https://www.slideshare.net/DICEStudio/five-rendering-ideas-from-battlefield-3-need-for-speed-the-run
*/

export class DepthOfField {
    oninit;

    #time = 0;
    #deltaTime = 0;
    #isDestroyed = false;
    passPreviewSize = 1 / 6;

    DOF_TEXTURE_SCALE = .5;

    PASS_COC = 1
    PASS_RESULT = 0

    camera = {
        rotation: 0,
        position: [0, 0, 150],
        matrix: twgl.m4.identity(),
        near: 1,
        far: 500
    };

    dof = {
        nearBlurry: 40,
        nearSharp: 110,
        farSharp: 200,
        farBlurry: 280
    };

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

        if (this.#isDestroyed) return;

        this.drawUniforms.u_deltaTime = this.#deltaTime;
        this.drawUniforms.u_worldInverseTransposeMatrix = twgl.m4.transpose(twgl.m4.inverse(this.drawUniforms.u_worldMatrix));

        this.instanceMatrices.forEach((mat, ndx) => {
            twgl.m4.rotateY(mat, this.#deltaTime * 0.000001 * (ndx + 1), mat);
        });

        this.#render();

        requestAnimationFrame((t) => this.run(t));
    }

    #render() {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        // Draw
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.useProgram(this.drawProgram);
        gl.bindVertexArray(this.cubeVAO);
        // upload the instance matrix buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceMatricesArray);
        //gl.uniform1f(this.drawLocations.u_deltaTime, this.drawUniforms.u_deltaTime);
        gl.uniformMatrix4fv(this.drawLocations.u_worldMatrix, false, this.drawUniforms.u_worldMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_viewMatrix, false, this.drawUniforms.u_viewMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_projectionMatrix, false, this.drawUniforms.u_projectionMatrix);
        gl.uniformMatrix4fv(this.drawLocations.u_worldInverseTransposeMatrix, false, this.drawUniforms.u_worldInverseTransposeMatrix);

        // draw depth and color 
        this.#setFramebuffer(gl, this.drawFramebuffer, this.drawFramebufferWidth, this.drawFramebufferHeight);
        gl.clearBufferfv(gl.COLOR, 0, [0., 0., 0., 1.]);
        gl.clearBufferfv(gl.DEPTH, 0, [1.]);
        gl.drawElementsInstanced(
            gl.TRIANGLES,
            this.cubeBuffers.numElements,
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
            ]
        );

        // render the composite to the draw framebuffer
        this.#renderComposite(this.PASS_RESULT);

        // draw the pass overlays
        let previewY = this.#renderPassPreview(0, this.PASS_COC);
        //previewY = this.#renderPassPreview(previewY, this.PASS_RESULT);
        //previewY = this.#renderPassPreview(previewY, this.PASS_RESULT);
    }

    #renderDofPass(fbo, w, h, program, locTex, locFloat = []) {
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

        locFloat.forEach(([loc, value], ndx) => {
            gl.uniform1f(loc, value);
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
            u_worldInverseTransposeMatrix: gl.getUniformLocation(this.drawProgram, 'u_worldInverseTransposeMatrix')
            //u_deltaTime: gl.getUniformLocation(this.drawProgram, 'u_deltaTime')
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
        };
        this.dofBlurVLocations = {
            a_position: gl.getAttribLocation(this.dofBlurVProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofBlurVProgram, 'a_uv'),
            u_midFarBlurTexture: gl.getUniformLocation(this.dofBlurVProgram, 'u_midFarBlurTexture'),
            u_nearBlurTexture: gl.getUniformLocation(this.dofBlurVProgram, 'u_nearBlurTexture'),
        };
        this.dofCompositeLocations = {
            a_position: gl.getAttribLocation(this.dofCompositeProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.dofCompositeProgram, 'a_uv'),
            u_packedTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_packedTexture'),
            u_midFarBlurTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_midFarBlurTexture'),
            u_nearBlurTexture: gl.getUniformLocation(this.dofCompositeProgram, 'u_nearBlurTexture'),
            u_passIndex: gl.getUniformLocation(this.dofCompositeProgram, 'u_passIndex')
        };

        // setup uniforms
        this.drawUniforms = {
            u_worldMatrix: twgl.m4.translate(twgl.m4.scaling([13, 13, 13]), [0, 0, 0]),
            u_viewMatrix: twgl.m4.identity(),
            u_projectionMatrix: twgl.m4.identity(),
            u_worldInverseTransposeMatrix: twgl.m4.identity()
        };

        /////////////////////////////////// GEOMETRY / MESH SETUP

        // create cube VAO
        this.cubeBuffers = twgl.primitives.createCubeBuffers(gl);
        this.cubeVAO = this.#makeVertexArray(gl, [
            [this.cubeBuffers.position, this.drawLocations.a_position, 3],
            [this.cubeBuffers.normal, this.drawLocations.a_normal, 3],
            [this.cubeBuffers.texcoord, this.drawLocations.a_uv, 2],
        ], this.cubeBuffers.indices);

        // create quad VAO
        this.quadBuffers = twgl.primitives.createXYQuadBuffers(gl);
        this.quadVAO = this.#makeVertexArray(gl, [
            [this.quadBuffers.position, this.dofPackLocations.a_position, 2],
            [this.quadBuffers.texcoord, this.dofPackLocations.a_uv, 2]
        ], this.quadBuffers.indices);


        // instances setup
        gl.bindVertexArray(this.cubeVAO);
        this.gridSize = 6;
        this.numInstances = this.gridSize * this.gridSize * this.gridSize;
        this.instanceMatricesArray = new Float32Array(this.numInstances * 16);
        this.instanceMatrices = [];
        const layerCount = this.gridSize * this.gridSize;
        const spacing = 62;
        const offset = Math.floor(this.gridSize / 2);
        for(let i=0; i<this.numInstances; ++i) {
            const x = i % this.gridSize - offset;
            const z = Math.floor(i / layerCount) - offset;
            const y = Math.floor((i % layerCount) / this.gridSize) - offset;
            const instanceMatrix = twgl.m4.translation([x * spacing, y * spacing, z * spacing]);
            const instanceMatrixArray = new Float32Array(this.instanceMatricesArray.buffer, i * 16 * 4, 16);
            instanceMatrixArray.set(instanceMatrix);
            this.instanceMatrices.push(instanceMatrixArray);
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

        this.#initTweakpane();

        if (this.oninit) this.oninit(this);
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
            this.#createTweakpaneSlider(cameraFolder, this.camera.position, 0, 'x', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(cameraFolder, this.camera.position, 1, 'y', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(cameraFolder, this.camera.position, 2, 'z', 50, 200, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(cameraFolder, this.camera, 'near', 'near', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            this.#createTweakpaneSlider(cameraFolder, this.camera, 'far', 'far', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            const dofSettings = this.pane.addFolder({ title: 'DoF Settings' });
            this.#createTweakpaneSlider(dofSettings, this.dof, 'nearBlurry', 'near blur', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'nearSharp', 'near sharp', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'farBlurry', 'far blur', 0, maxFar);
            this.#createTweakpaneSlider(dofSettings, this.dof, 'farSharp', 'far sharp', 0, maxFar);
            const passViewsFolder = this.pane.addFolder({ title: 'Render Passes' });
            this.#createTweakpaneSlider(passViewsFolder, this, 'passPreviewSize', 'Preview Size', 0, 1);
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
