/** @type {WebGLRenderingContext} */
let gl;
let texCoordBuffer;
let fragShader;
let shaderProgram;

/** @type {HTMLFormElement} */
let form = document.forms["settings"];

/** @type {HTMLTextAreaElement} */
let textArea = document.getElementById("citro3d");

function generateShaderSource() {
    const shifts = [
        "0.0",
        "{0} * mod(floor(trunc({1}) / 2.0), 2.0)",
        "{0} * mod(floor(trunc({1} + 1.0) / 2.0), 2.0)"
    ];
    const clamps = [
        "{0} > 1.0 ? 0.0 : {0}",
        "min({0}, 1.0)",
        "fract({0})",
        "trunc({0}) == 0.0 ? fract({0}) : 1.0 - fract({0})",
        "{0} > 0.5 ? 1.0 : 0.0"
    ]
    const maps = [
        "u",
        "u * u",
        "v",
        "v * v",
        "(u + v) * 0.5",
        "(u * u + v * v) * 0.5",
        "min(sqrt(u * u + v * v), 1.0)",
        "min(u, v)",
        "max(u, v)",
        "min(((u + v) * 0.5 + sqrt(u * u + v * v)) * 0.5, 1.0)",
    ];
    const component_select = [
        "vec4(final_colour.xyz, 1.0)",
        "vec4(final_colour.a, final_colour.a, final_colour.a, 1.0)",
        "final_colour",
    ];
    return `#version 300 es

        in lowp vec2 vTexcoord;
        out lowp vec4 fragColor;
        
        void main() {
            lowp float u = abs(vTexcoord.x);
            lowp float v = abs(vTexcoord.y);
            lowp float u_shift = ${shifts[form.uShift.value]
                .replaceAll("{0}", form.uClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "v")};
            lowp float v_shift = ${shifts[form.vShift.value]
                .replaceAll("{0}", form.vClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "u")};
            u += u_shift;
            v += v_shift;
            u = ${clamps[form.uClamp.value].replaceAll("{0}", "u")};
            v = ${clamps[form.vClamp.value].replaceAll("{0}", "v")};
            lowp float lut_coord = ${maps[form.rgbFunc.value]};
            lowp vec4 final_colour = vec4(lut_coord, lut_coord, lut_coord, ${form.alphaSeparate.checked ? maps[form.alphaFunc.value] : 'lut_coord'});
            fragColor = ${component_select[form.showComponent.value]};
        }
    `;
}

function citro3d() {
    return `
        C3D_ProcTex pt;
        C3D_ProcTexInit(&pt, ${form.texOffset.value}, ${form.texWidth.value});
        C3D_ProcTexClamp(&pt, ${form.uClamp.value}, ${form.vClamp.value});
        C3D_ProcTexCombiner(&pt, ${!!form.alphaSeparate.value}, ${form.rgbFunc.value}, ${form.alphaFunc.value});
        C3D_ProcTexShift(&pt, ${form.uShift.value}, ${form.vShift.value});
        C3D_ProcTexFilter(&pt, ${form.minFilter.value});
        ${form.enableNoise.checked ? `
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_U, ${form.uNoiseAmpl.value}, ${form.uNoiseFreq.value}, ${form.uNoisePhase.value});
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_V, ${form.vNoiseAmpl.value}, ${form.vNoiseFreq.value}, ${form.vNoisePhase.value});
        ` : ''}
        C3D_ProcTexLodBias(&pt, ${form.lodBias.value});
        
    `.replaceAll(/^\s+/gm, "").trimEnd();
}

function setup() {
    form.addEventListener("change", draw);
    const c = document.getElementById("tex");
    gl = c.getContext("webgl2");

    // set up initial shaders
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, document.getElementById("vert").textContent);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
        alert("vert error: " + gl.getShaderInfoLog(vert));
    }
    fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, document.getElementById("frag").textContent);
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        alert("frag error: " + gl.getShaderInfoLog(fragShader));
    }
    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vert);
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);
    
    // set up position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.vertexAttribPointer(
        gl.getAttribLocation(shaderProgram, "aPosition"),
        2,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(gl.getAttribLocation(shaderProgram, "aPosition"));

    // set up texcoord buffer
    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(
        gl.getAttribLocation(shaderProgram, "aTexcoord"),
        2,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(gl.getAttribLocation(shaderProgram, "aTexcoord"));

    // other setup
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);

    // refresh shader
    gl.detachShader(shaderProgram, fragShader);
    console.log(generateShaderSource());
    gl.shaderSource(fragShader, generateShaderSource());
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        alert("gen'd frag error: " + gl.getShaderInfoLog(fragShader));
    }
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert("gen'd link error: " + gl.getProgramInfoLog(shaderProgram));
    }
    gl.useProgram(shaderProgram);

    // refresh texture coordinates
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const tcLeft = form.tcLeft.value;
    const tcTop = form.tcTop.value;
    const tcRight = form.tcRight.value;
    const tcBottom = form.tcBottom.value;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([tcLeft, tcTop, tcRight, tcTop, tcLeft, tcBottom, tcRight, tcBottom]), gl.DYNAMIC_DRAW);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    textArea.value = citro3d();
}

setup();
draw();