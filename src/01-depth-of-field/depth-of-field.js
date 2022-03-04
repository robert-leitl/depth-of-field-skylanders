
import * as twgl from 'twgl.js';
import drawFragmentShaderSource from './shader/draw.frag';
import drawVertexShaderSource from './shader/draw.vert';

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
        //this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

        this.#updateProjectionMatrix();
    }

    run(time = 0) {
        this.#deltaTime = time - this.#time;
        this.#time = time;

        if (this.#isDestroyed) return;

        this.drawUniforms.u_deltaTime = this.#deltaTime;

        this.instanceMatrices.forEach((mat, ndx) => {
            twgl.m4.rotateY(mat, this.#deltaTime * 0.0005 * (ndx + 1), mat);
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

        // draw the particles
        this.gl.useProgram(this.drawProgram);
        this.gl.bindVertexArray(this.cubeVAO);
        // upload the instance matrix buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.matrixBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceMatricesArray);
        this.gl.uniformMatrix4fv(this.drawLocations.u_worldMatrix, false, this.drawUniforms.u_worldMatrix);
        this.gl.uniformMatrix4fv(this.drawLocations.u_viewMatrix, false, this.drawUniforms.u_viewMatrix);
        this.gl.uniformMatrix4fv(this.drawLocations.u_projectionMatrix, false, this.drawUniforms.u_projectionMatrix);
        //this.gl.drawElements(this.gl.TRIANGLES, this.cubeBuffers.numElements, this.gl.UNSIGNED_SHORT, 0);
        this.gl.drawElementsInstanced(
            this.gl.TRIANGLES,
            this.cubeBuffers.numElements,
            this.gl.UNSIGNED_SHORT,
            0,
            this.numInstances
        )
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

        // find the locations
        this.drawLocations = {
            a_position: this.gl.getAttribLocation(this.drawProgram, 'a_position'),
            a_normal: this.gl.getAttribLocation(this.drawProgram, 'a_normal'),
            a_uv: this.gl.getAttribLocation(this.drawProgram, 'a_uv'),
            a_instanceMatrix: this.gl.getAttribLocation(this.drawProgram, 'a_instanceMatrix'),
            u_worldMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_worldMatrix'),
            u_viewMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_viewMatrix'),
            u_projectionMatrix: this.gl.getUniformLocation(this.drawProgram, 'u_projectionMatrix'),
            u_deltaTime: this.gl.getUniformLocation(this.drawProgram, 'u_deltaTime')
        };

        console.log(this.drawLocations);

        // create cube VAO
        this.cubeBuffers = twgl.primitives.createCubeBuffers(this.gl);
        this.cubeVAO = this.#makeVertexArray(this.gl, [
            [this.cubeBuffers.position, this.drawLocations.a_position, 3],
            [this.cubeBuffers.normal, this.drawLocations.a_normal, 3],
            [this.cubeBuffers.texcoord, this.drawLocations.a_uv, 2],
        ], this.cubeBuffers.indices);


        // instances setup
        this.numInstances = 9;
        this.instanceMatricesArray = new Float32Array(this.numInstances * 16);
        this.instanceMatrices = [];
        for(let i=0; i<this.numInstances; ++i) {
            const x = i % 3 - 1;
            const y = Math.floor(i / 3) - 1;
            const instanceMatrix = twgl.m4.translation([x * 30, y * 30, 0]);
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

        // init the global uniforms
        this.drawUniforms = {
            u_worldMatrix: twgl.m4.translate(twgl.m4.scaling([20, 20, 20]), [0, 0, 0]),
            u_viewMatrix: twgl.m4.identity(),
            u_projectionMatrix: twgl.m4.identity()
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

    #createProgram(gl, shaderSources, transformFeedbackVaryings) {
        const program = gl.createProgram();

        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, ndx) => {
            const shader = this.#createShader(gl, type, shaderSources[ndx]);
            gl.attachShader(program, shader);
        });

        if (transformFeedbackVaryings) {
            gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.SEPARATE_ATTRIBS);
        }

        gl.linkProgram(program);
        const success = gl.getProgramParameter(program, gl.LINK_STATUS);

        if (success) {
            return program;
        }

        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    }

    #updateCameraMatrix() {
        twgl.m4.lookAt(this.camera.position, [0, 0, 0], [0, 1, 0], this.camera.matrix);
        twgl.m4.inverse(this.camera.matrix, this.drawUniforms.u_viewMatrix);
    }

    #updateProjectionMatrix() {
        const aspect = this.gl.canvas.clientWidth / this.gl.canvas.clientHeight;
        twgl.m4.perspective(Math.PI / 4, aspect, 2, 250, this.drawUniforms.u_projectionMatrix);
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
        }
    }
}
