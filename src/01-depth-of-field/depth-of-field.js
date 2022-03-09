
import * as twgl from 'twgl.js';
import drawFragmentShaderSource from './shader/draw.frag';
import drawVertexShaderSource from './shader/draw.vert';
import depthFragmentShaderSource from './shader/depth.frag';
import depthVertexShaderSource from './shader/depth.vert';
import nearFieldFragmentShaderSource from './shader/near-field.frag';
import nearFieldVertexShaderSource from './shader/near-field.vert';
import colorFragmentShaderSource from './shader/color.frag';
import colorVertexShaderSource from './shader/color.vert';
import gaussianBlurFragmentShaderSource from './shader/gaussian-blur.frag';
import gaussianBlurVertexShaderSource from './shader/gaussian-blur.vert';
import compositeFragmentShaderSource from './shader/composite.frag';
import compositeVertexShaderSource from './shader/composite.vert';
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
    intermediatePreviewSize = 1 / 6;

    camera = {
        rotation: 0,
        position: [0, 0, 150],
        matrix: twgl.m4.identity()
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
            twgl.m4.rotateY(mat, this.#deltaTime * 0.000005 * (ndx + 1), mat);
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

        // separate the near field 
        /*this.#setFramebuffer(gl, this.framebufferA, this.fboWidth, this.fboHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.nearFieldProgram);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.nearFieldLocations.u_depthTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.nearFieldLocations.u_colorTexture, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(gl, null, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // blur the nearfield image
        const blurredNearFieldTexture = this.#blur(this.framebufferTextureA, this.framebufferA, this.framebufferTextureA);
        const blurredFarFieldTexture = this.#blur(this.colorTexture, this.framebufferC, this.framebufferTextureC);

        // draw composite image
        gl.useProgram(this.compositeProgram);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.compositeLocations.u_depthTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.compositeLocations.u_colorTexture, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.uniform1i(this.compositeLocations.u_nearFieldTexture, 2);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, blurredNearFieldTexture);
        gl.uniform1i(this.compositeLocations.u_farFieldTexture, 3);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, blurredFarFieldTexture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);*/

        // draw the pass overlays
        let intermediatePreviewY = this.#renderIntermediatePreview(0, this.colorTexture);
        intermediatePreviewY = this.#renderIntermediatePreview(intermediatePreviewY, this.depthTexture);

        // draw the near field
        /*y += h;
        gl.scissor(0, y, w, h);
        gl.viewport(0, y, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.colorProgram);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.colorLocations.u_colorTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurredNearFieldTexture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);

        // draw the blurred near field
        y += h;
        gl.scissor(0, y, w, h);
        gl.viewport(0, y, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.colorProgram);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.colorLocations.u_colorTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurredFarFieldTexture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);

        gl.disable(gl.SCISSOR_TEST);*/
    }

    #renderIntermediatePreview(y = 0, texture) {
        const gl  = this.gl;

        const w = gl.canvas.width * this.intermediatePreviewSize;
        const h = gl.canvas.height * this.intermediatePreviewSize;

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y, w, h);
        gl.viewport(0, y, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.colorProgram);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.colorLocations.u_colorTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.SCISSOR_TEST);

        return y + h;
    }

    #blur(texture, outFBO, outTex) {
        this.#setFramebuffer(gl, this.framebufferB, this.fboWidth, this.fboHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.gaussianBlurProgram);
        gl.uniform2f(this.gaussianBlurLocations.u_direction, this.blurUniforms.u_blurSize, 0);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.gaussianBlurLocations.u_colorTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);

        this.#setFramebuffer(gl, outFBO, this.fboWidth, this.fboHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.gaussianBlurProgram);
        gl.uniform2f(this.gaussianBlurLocations.u_direction, 0, this.blurUniforms.u_blurSize);
        gl.bindVertexArray(this.quadVAO);
        gl.uniform1i(this.gaussianBlurLocations.u_colorTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureB);
        gl.drawElements(gl.TRIANGLES, this.quadBuffers.numElements, gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(gl, null, gl.drawingBufferWidth, gl.drawingBufferHeight);

        return outTex;
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
        this.drawProgram = this.#createProgram(gl, [drawVertexShaderSource, drawFragmentShaderSource]);
        this.depthProgram = this.#createProgram(gl, [depthVertexShaderSource, depthFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.nearFieldProgram = this.#createProgram(gl, [nearFieldVertexShaderSource, nearFieldFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.colorProgram = this.#createProgram(gl, [colorVertexShaderSource, colorFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.gaussianBlurProgram = this.#createProgram(gl, [gaussianBlurVertexShaderSource, gaussianBlurFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.compositeProgram = this.#createProgram(gl, [compositeVertexShaderSource, compositeFragmentShaderSource], null, {a_position: 0, a_uv: 1});

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
        this.depthLocations = {
            a_position: gl.getAttribLocation(this.depthProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.depthProgram, 'a_uv'),
            u_depthTexture: gl.getUniformLocation(this.depthProgram, 'u_depthTexture'),
            u_colorTexture: gl.getUniformLocation(this.depthProgram, 'u_colorTexture')
        };
        this.nearFieldLocations = {
            a_position: gl.getAttribLocation(this.nearFieldProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.nearFieldProgram, 'a_uv'),
            u_depthTexture: gl.getUniformLocation(this.nearFieldProgram, 'u_depthTexture'),
            u_colorTexture: gl.getUniformLocation(this.nearFieldProgram, 'u_colorTexture')
        };
        this.colorLocations = {
            a_position: gl.getAttribLocation(this.colorProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.colorProgram, 'a_uv'),
            u_colorTexture: gl.getUniformLocation(this.colorProgram, 'u_colorTexture')
        };
        this.gaussianBlurLocations = {
            a_position: gl.getAttribLocation(this.gaussianBlurProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.gaussianBlurProgram, 'a_uv'),
            u_colorTexture: gl.getUniformLocation(this.gaussianBlurProgram, 'u_colorTexture'),
            u_direction: gl.getUniformLocation(this.gaussianBlurProgram, 'u_direction')
        };
        this.compositeLocations = {
            a_position: gl.getAttribLocation(this.compositeProgram, 'a_position'),
            a_uv: gl.getAttribLocation(this.compositeProgram, 'a_uv'),
            u_depthTexture: gl.getUniformLocation(this.compositeProgram, 'u_depthTexture'),
            u_colorTexture: gl.getUniformLocation(this.compositeProgram, 'u_colorTexture'),
            u_nearFieldTexture: gl.getUniformLocation(this.compositeProgram, 'u_nearFieldTexture'),
            u_farFieldTexture: gl.getUniformLocation(this.compositeProgram, 'u_farFieldTexture')
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
            [this.quadBuffers.position, this.depthLocations.a_position, 2],
            [this.quadBuffers.texcoord, this.depthLocations.a_uv, 2]
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
            const instanceMatrix = twgl.m4.scale(twgl.m4.translation([x * spacing, y * spacing, z * spacing]), [Math.random() + .5, Math.random() + 0.75, Math.random() + .5]);
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
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        // color renderbuffer setup
        this.colorRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, gl.getParameter(gl.MAX_SAMPLES), gl.RGBA8, clientWidth, clientHeight);
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
        gl.texImage2D(this. gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);   
        // color texture setup
        this.colorTexture = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, clientWidth, clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error('could not complete render framebuffer setup')
        }


       /* this.framebufferTextureA = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.framebufferA = this.#createFrameBuffer(this.framebufferTextureA);

        this.framebufferTextureB = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.framebufferB = this.#createFrameBuffer(this.framebufferTextureB);

        this.framebufferTextureC = this.#createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureC);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.framebufferC = this.#createFrameBuffer(this.framebufferTextureC);*/

        // init the global uniforms
        this.drawUniforms = {
            u_worldMatrix: twgl.m4.translate(twgl.m4.scaling([13, 13, 13]), [0, 0, 0]),
            u_viewMatrix: twgl.m4.identity(),
            u_projectionMatrix: twgl.m4.identity(),
            u_worldInverseTransposeMatrix: twgl.m4.identity()
        };

        this.blurUniforms = {
            u_blurSize: 5
        };

        this.resize();

        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.#initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    #createFrameBuffer(gl, texture) {
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(
                gl.FRAMEBUFFER,       // target
                gl.COLOR_ATTACHMENT0,  // attachment point
                gl.TEXTURE_2D,        // texture target
                texture,         // texture
                0);
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


        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight);
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, gl.getParameter(gl.MAX_SAMPLES), gl.RGBA8, clientWidth, clientHeight);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(this. gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, clientWidth, clientHeight, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, clientWidth, clientHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        

        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        /*gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, this.canvasWidth, this.canvasHeight, 0, gl.DEPTH_COMPONENT, gl.FLOAT, new Float32Array(this.canvasWidth * this.canvasHeight));
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvasWidth, this.canvasHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fboWidth, this.fboHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fboWidth, this.fboHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, this.framebufferTextureC);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fboWidth, this.fboHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);*/
    }

    #updateCameraMatrix() {
        twgl.m4.lookAt(this.camera.position, [0, 0, 0], [0, 1, 0], this.camera.matrix);
        twgl.m4.inverse(this.camera.matrix, this.drawUniforms.u_viewMatrix);
    }

    #updateProjectionMatrix(gl) {
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        twgl.m4.perspective(Math.PI / 4, aspect, 1, 500, this.drawUniforms.u_projectionMatrix);
    }

    #initTweakpane() {
        if (this.pane) {
            this.#createTweakpaneSlider(this.pane, this.camera.position, 0, 'camera.x', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(this.pane, this.camera.position, 1, 'camera.y', -100, 100, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(this.pane, this.camera.position, 2, 'camera.z', 50, 200, 1, () => this.#updateCameraMatrix());
            this.#createTweakpaneSlider(this.pane, this, 'intermediatePreviewSize', 'Preview Size', 0, 1);
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
