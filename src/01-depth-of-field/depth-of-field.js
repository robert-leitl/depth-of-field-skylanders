
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
        twgl.resizeCanvasToDisplaySize(this.gl.canvas);
        
        // When you need to set the viewport to match the size of the canvas's
        // drawingBuffer this will always be correct
        this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        this.#resizeTextures();

        this.#updateProjectionMatrix();
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
        // Draw
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.enable(this.gl.CULL_FACE);
        this.gl.useProgram(this.drawProgram);
        this.gl.bindVertexArray(this.cubeVAO);
        // upload the instance matrix buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.matrixBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceMatricesArray);
        //this.gl.uniform1f(this.drawLocations.u_deltaTime, this.drawUniforms.u_deltaTime);
        this.gl.uniformMatrix4fv(this.drawLocations.u_worldMatrix, false, this.drawUniforms.u_worldMatrix);
        this.gl.uniformMatrix4fv(this.drawLocations.u_viewMatrix, false, this.drawUniforms.u_viewMatrix);
        this.gl.uniformMatrix4fv(this.drawLocations.u_projectionMatrix, false, this.drawUniforms.u_projectionMatrix);
        this.gl.uniformMatrix4fv(this.drawLocations.u_worldInverseTransposeMatrix, false, this.drawUniforms.u_worldInverseTransposeMatrix);

        // draw depth and pinhole 
        this.#setFramebuffer(this.gl, this.depthColorFramebuffer, this.canvasWidth, this.canvasHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.drawElementsInstanced(
            this.gl.TRIANGLES,
            this.cubeBuffers.numElements,
            this.gl.UNSIGNED_SHORT,
            0,
            this.numInstances
        )
        this.#setFramebuffer(this.gl, null, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);


        // separate the near field 
        this.#setFramebuffer(this.gl, this.nearFieldFramebuffer, this.fboWidth, this.fboHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.nearFieldProgram);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.nearFieldLocations.u_depthTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
        this.gl.uniform1i(this.nearFieldLocations.u_colorTexture, 1);
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(this.gl, null, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);

        // blur the nearfield image
        this.#blur(this.nearFieldTexture);

        // draw scene 
        /*this.gl.useProgram(this.drawProgram);
        this.gl.bindVertexArray(this.cubeVAO);
        this.gl.drawElementsInstanced(
            this.gl.TRIANGLES,
            this.cubeBuffers.numElements,
            this.gl.UNSIGNED_SHORT,
            0,
            this.numInstances
        );*/

        // draw composite image
        this.gl.useProgram(this.compositeProgram);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.compositeLocations.u_depthTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
        this.gl.uniform1i(this.compositeLocations.u_colorTexture, 1);
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        this.gl.uniform1i(this.compositeLocations.u_nearFieldTexture, 2);
        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurVTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);

        // draw the pass overlays
        let y = 0;
        const w = this.gl.canvas.width / 6;
        const h = this.gl.canvas.height / 6;
        this.gl.enable(this.gl.SCISSOR_TEST);

        // draw the depth texture
        this.gl.scissor(0, y, w, h);
        this.gl.viewport(0, y, w, h);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.depthProgram);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.depthLocations.u_depthTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
        this.gl.uniform1i(this.depthLocations.u_colorTexture, 1);
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);

        // draw the near field
        y += h;
        this.gl.scissor(0, y, w, h);
        this.gl.viewport(0, y, w, h);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.colorProgram);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.colorLocations.u_colorTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.nearFieldTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);

        // draw the blurred near field
        y += h;
        this.gl.scissor(0, y, w, h);
        this.gl.viewport(0, y, w, h);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.colorProgram);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.colorLocations.u_colorTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurVTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);

        this.gl.disable(this.gl.SCISSOR_TEST);
    }

    #blur(texture) {
        this.#setFramebuffer(this.gl, this.blurHFramebuffer, this.fboWidth, this.fboHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.gaussianBlurProgram);
        this.gl.uniform2f(this.gaussianBlurLocations.u_direction, 1, 0);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.gaussianBlurLocations.u_colorTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(this.gl, null, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);

        this.#setFramebuffer(this.gl, this.blurVFramebuffer, this.fboWidth, this.fboHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.useProgram(this.gaussianBlurProgram);
        this.gl.uniform2f(this.gaussianBlurLocations.u_direction, 0, 1);
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.uniform1i(this.gaussianBlurLocations.u_colorTexture, 0);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurHTexture);
        this.gl.drawElements(this.gl.TRIANGLES, this.quadBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);
        this.#setFramebuffer(this.gl, null, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
    }

    destroy() {
        this.#isDestroyed = true;
    }

    #init() {
        /** @type {WebGLRenderingContext} */
        this.gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false });
        if (!this.gl) {
            throw new Error('No WebGL 2 context!')
        }

        // setup programs
        this.drawProgram = this.#createProgram(this.gl, [drawVertexShaderSource, drawFragmentShaderSource]);
        this.depthProgram = this.#createProgram(this.gl, [depthVertexShaderSource, depthFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.nearFieldProgram = this.#createProgram(this.gl, [nearFieldVertexShaderSource, nearFieldFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.colorProgram = this.#createProgram(this.gl, [colorVertexShaderSource, colorFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.gaussianBlurProgram = this.#createProgram(this.gl, [gaussianBlurVertexShaderSource, gaussianBlurFragmentShaderSource], null, {a_position: 0, a_uv: 1});
        this.compositeProgram = this.#createProgram(this.gl, [compositeVertexShaderSource, compositeFragmentShaderSource], null, {a_position: 0, a_uv: 1});

        // find the locations
        this.drawLocations = {
            a_position: this.gl.getAttribLocation(this.drawProgram, 'a_position'),
            a_normal: this.gl.getAttribLocation(this.drawProgram, 'a_normal'),
            a_uv: this.gl.getAttribLocation(this.drawProgram, 'a_uv'),
            a_instanceMatrix: this.gl.getAttribLocation(this.drawProgram, 'a_instanceMatrix'),
            u_worldMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_worldMatrix'),
            u_viewMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_viewMatrix'),
            u_projectionMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_projectionMatrix'),
            u_worldInverseTransposeMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_worldInverseTransposeMatrix')
            //u_deltaTime: this.gl.getUniformLocation(this.drawProgram, 'u_deltaTime')
        };
        this.depthLocations = {
            a_position: this.gl.getAttribLocation(this.depthProgram, 'a_position'),
            a_uv: this.gl.getAttribLocation(this.depthProgram, 'a_uv'),
            u_depthTexture: this.gl.getUniformLocation(this.depthProgram, 'u_depthTexture'),
            u_colorTexture: this.gl.getUniformLocation(this.depthProgram, 'u_colorTexture')
        };
        this.nearFieldLocations = {
            a_position: this.gl.getAttribLocation(this.nearFieldProgram, 'a_position'),
            a_uv: this.gl.getAttribLocation(this.nearFieldProgram, 'a_uv'),
            u_depthTexture: this.gl.getUniformLocation(this.nearFieldProgram, 'u_depthTexture'),
            u_colorTexture: this.gl.getUniformLocation(this.nearFieldProgram, 'u_colorTexture')
        };
        this.colorLocations = {
            a_position: this.gl.getAttribLocation(this.colorProgram, 'a_position'),
            a_uv: this.gl.getAttribLocation(this.colorProgram, 'a_uv'),
            u_colorTexture: this.gl.getUniformLocation(this.colorProgram, 'u_colorTexture')
        };
        this.gaussianBlurLocations = {
            a_position: this.gl.getAttribLocation(this.gaussianBlurProgram, 'a_position'),
            a_uv: this.gl.getAttribLocation(this.gaussianBlurProgram, 'a_uv'),
            u_colorTexture: this.gl.getUniformLocation(this.gaussianBlurProgram, 'u_colorTexture'),
            u_direction: this.gl.getUniformLocation(this.gaussianBlurProgram, 'u_direction')
        };
        this.compositeLocations = {
            a_position: this.gl.getAttribLocation(this.compositeProgram, 'a_position'),
            a_uv: this.gl.getAttribLocation(this.compositeProgram, 'a_uv'),
            u_depthTexture: this.gl.getUniformLocation(this.compositeProgram, 'u_depthTexture'),
            u_colorTexture: this.gl.getUniformLocation(this.compositeProgram, 'u_colorTexture'),
            u_nearFieldTexture: this.gl.getUniformLocation(this.compositeProgram, 'u_nearFieldTexture')
        };

        // create cube VAO
        this.cubeBuffers = twgl.primitives.createCubeBuffers(this.gl);
        this.cubeVAO = this.#makeVertexArray(this.gl, [
            [this.cubeBuffers.position, this.drawLocations.a_position, 3],
            [this.cubeBuffers.normal, this.drawLocations.a_normal, 3],
            [this.cubeBuffers.texcoord, this.drawLocations.a_uv, 2],
        ], this.cubeBuffers.indices);

        // create quad VAO
        this.quadBuffers = twgl.primitives.createXYQuadBuffers(this.gl);
        this.quadVAO = this.#makeVertexArray(this.gl, [
            [this.quadBuffers.position, this.depthLocations.a_position, 2],
            [this.quadBuffers.texcoord, this.depthLocations.a_uv, 2]
        ], this.quadBuffers.indices);


        // instances setup
        this.gl.bindVertexArray(this.cubeVAO);
        this.gridSize = 5;
        this.numInstances = this.gridSize * this.gridSize * this.gridSize;
        this.instanceMatricesArray = new Float32Array(this.numInstances * 16);
        this.instanceMatrices = [];
        const layerCount = this.gridSize * this.gridSize;
        const spacing = 22;
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
        this.matrixBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.matrixBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceMatricesArray.byteLength, this.gl.DYNAMIC_DRAW);
        const mat4AttribSlotCount = 4;
        const bytesPerMatrix = 16 * 4;
        for(let j=0; j<mat4AttribSlotCount; ++j) {
            const loc = this.drawLocations.a_instanceMatrix + j;
            this.gl.enableVertexAttribArray(loc);
            this.gl.vertexAttribPointer(
                loc,
                4,
                this.gl.FLOAT,
                false,
                bytesPerMatrix, // stride, num bytes to advance to get to next set of values
                j * 4 * 4 // one row = 4 values each 4 bytes
            );
            this.gl.vertexAttribDivisor(loc, 1); // it sets this attribute to only advance to the next value once per instance
        }
        this.gl.bindVertexArray(null);

         // create the framebuffer to render the depth texture into
         this.depthTexture = this.#createAndSetupTexture(this.gl, this.gl.NEAREST, this.gl.NEAREST);
         this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
         this.gl.texImage2D(
            this. gl.TEXTURE_2D,      // target
             0,                  // mip level
             this.gl.DEPTH_COMPONENT32F, // internal format
             this.gl.canvas.clientWidth,   // width
             this.gl.canvas.clientHeight,   // height
             0,                  // border
             this.gl.DEPTH_COMPONENT, // format
             this.gl.FLOAT,           // type
             null);              // data
         this.depthColorFramebuffer = this.gl.createFramebuffer();
         this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.depthColorFramebuffer);
         this.gl.framebufferTexture2D(
            this.gl.FRAMEBUFFER,       // target
            this.gl.DEPTH_ATTACHMENT,  // attachment point
            this.gl.TEXTURE_2D,        // texture target
             this.depthTexture,         // texture
             0);                   // mip level
        // create the textor for the pinhole image
        this.colorTexture = this.#createAndSetupTexture(this.gl, this.gl.LINEAR, this.gl.LINEAR);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.canvas.clientWidth, this.gl.canvas.clientHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.framebufferTexture2D(
                this.gl.FRAMEBUFFER,       // target
                this.gl.COLOR_ATTACHMENT0,  // attachment point
                this.gl.TEXTURE_2D,        // texture target
                this.colorTexture,         // texture
                0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        // create the first pass framebuffer and texture
        this.nearFieldTexture = this.#createAndSetupTexture(this.gl, this.gl.LINEAR, this.gl.LINEAR);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.nearFieldTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.canvas.clientWidth, this.gl.canvas.clientHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.nearFieldFramebuffer = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.nearFieldFramebuffer);
        this.gl.framebufferTexture2D(
                this.gl.FRAMEBUFFER,       // target
                this.gl.COLOR_ATTACHMENT0,  // attachment point
                this.gl.TEXTURE_2D,        // texture target
                this.nearFieldTexture,         // texture
                0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        // create the horizontal blur pass framebuffer and texture
        this.blurHTexture = this.#createAndSetupTexture(this.gl, this.gl.LINEAR, this.gl.LINEAR);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurHTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.canvas.clientWidth, this.gl.canvas.clientHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.blurHFramebuffer = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurHFramebuffer);
        this.gl.framebufferTexture2D(
                this.gl.FRAMEBUFFER,       // target
                this.gl.COLOR_ATTACHMENT0,  // attachment point
                this.gl.TEXTURE_2D,        // texture target
                this.blurHTexture,         // texture
                0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        // create the vertical blur pass framebuffer and texture
        this.blurVTexture = this.#createAndSetupTexture(this.gl, this.gl.LINEAR, this.gl.LINEAR);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurVTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.canvas.clientWidth, this.gl.canvas.clientHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.blurVFramebuffer = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurVFramebuffer);
        this.gl.framebufferTexture2D(
                this.gl.FRAMEBUFFER,       // target
                this.gl.COLOR_ATTACHMENT0,  // attachment point
                this.gl.TEXTURE_2D,        // texture target
                this.blurVTexture,         // texture
                0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        

        // init the global uniforms
        this.drawUniforms = {
            u_worldMatrix: twgl.m4.translate(twgl.m4.scaling([10, 10, 10]), [0, 0, 0]),
            u_viewMatrix: twgl.m4.identity(),
            u_projectionMatrix: twgl.m4.identity(),
            u_worldInverseTransposeMatrix: twgl.m4.identity()
        };

        this.blurUniforms = {
            u_blurSize: 20
        };

        this.resize();

        this.#updateCameraMatrix();
        this.#updateProjectionMatrix();

        this.#initTweakpane();

        if (this.oninit) this.oninit(this);
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

    #resizeTextures() {
        this.canvasWidth = this.gl.canvas.width;
        this.canvasHeight = this.gl.canvas.height;
        this.fboWidth = this.canvasWidth / 2;
        this.fboHeight = this.canvasHeight / 2;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.DEPTH_COMPONENT32F, this.canvasWidth, this.canvasHeight, 0, this.gl.DEPTH_COMPONENT, this.gl.FLOAT, new Float32Array(this.canvasWidth * this.canvasHeight));
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.canvasWidth, this.canvasHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.nearFieldTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.fboWidth, this.fboHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurHTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.fboWidth, this.fboHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurVTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.fboWidth, this.fboHeight, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    }

    #updateCameraMatrix() {
        twgl.m4.lookAt(this.camera.position, [0, 0, 0], [0, 1, 0], this.camera.matrix);
        twgl.m4.inverse(this.camera.matrix, this.drawUniforms.u_viewMatrix);
    }

    #updateProjectionMatrix() {
        const aspect = this.gl.canvas.clientWidth / this.gl.canvas.clientHeight;
        twgl.m4.perspective(Math.PI / 4, aspect, 80, 200, this.drawUniforms.u_projectionMatrix);
    }

    #initTweakpane() {
        if (this.pane) {
            const cameraYSlider = this.pane.addBlade({
                view: 'slider',
                label: 'c.y',
                min: -100,
                max: 100,
                value: this.camera.position[1],
            });
            cameraYSlider.on('change', e => {
                this.camera.position[1] = e.value;
                this.#updateCameraMatrix();
            });

            const cameraXSlider = this.pane.addBlade({
                view: 'slider',
                label: 'c.x',
                min: -100,
                max: 100,
                value: this.camera.position[0],
            });
            cameraXSlider.on('change', e => {
                this.camera.position[0] = e.value;
                this.#updateCameraMatrix();
            });

            const cameraZSlider = this.pane.addBlade({
                view: 'slider',
                label: 'c.z',
                min: 50,
                max: 200,
                value: this.camera.position[2],
            });
            cameraZSlider.on('change', e => {
                this.camera.position[2] = e.value;
                this.#updateCameraMatrix();
                this.#updateProjectionMatrix();
            });

            const blurSlider = this.pane.addBlade({
                view: 'slider',
                label: 'blur',
                min: 0,
                max: 50,
                value: this.blurUniforms.u_blurSize,
            });

            blurSlider.on('change', e => {
                this.blurUniforms.u_blurSize = e.value;
            });
        }
    }
}
