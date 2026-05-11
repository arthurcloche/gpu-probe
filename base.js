// Get the WebGL2 context
const gl = $0.getContext('webgl2');

// Storage for discovered programs and shaders
const discoveredPrograms = new Set();
const discoveredShaders = new Set();
const capturedData = {
    programs: [],
    shaders: []
};

// Capture current program if one is bound
const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
if (currentProgram) {
    discoveredPrograms.add(currentProgram);
}

// Helper function to extract shader info
function extractShaderInfo(shader) {
    if (!shader) return null;
    return {
        type: gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER',
        source: gl.getShaderSource(shader),
        compiled: gl.getShaderParameter(shader, gl.COMPILE_STATUS),
        deleteStatus: gl.getShaderParameter(shader, gl.DELETE_STATUS)
    };
}

// Intercept useProgram to capture all programs
const originalUseProgram = gl.useProgram.bind(gl);
gl.useProgram = function(program) {
    if (program) {
        discoveredPrograms.add(program);
    }
    return originalUseProgram(program);
};

// Intercept drawArrays
const originalDrawArrays = gl.drawArrays.bind(gl);
gl.drawArrays = function(...args) {
    const prog = gl.getParameter(gl.CURRENT_PROGRAM);
    if (prog) discoveredPrograms.add(prog);
    return originalDrawArrays(...args);
};

// Intercept drawElements
const originalDrawElements = gl.drawElements.bind(gl);
gl.drawElements = function(...args) {
    const prog = gl.getParameter(gl.CURRENT_PROGRAM);
    if (prog) discoveredPrograms.add(prog);
    return originalDrawElements(...args);
};

// Function to extract all discovered data
function extractAllShaders() {
    capturedData.programs = [];
    capturedData.shaders = [];
    
    discoveredPrograms.forEach((program, idx) => {
        const shaders = gl.getAttachedShaders(program);
        const programInfo = {
            programIndex: idx,
            active: gl.getParameter(gl.CURRENT_PROGRAM) === program,
            linked: gl.getProgramParameter(program, gl.LINK_STATUS),
            validated: gl.getProgramParameter(program, gl.VALIDATE_STATUS),
            shaders: []
        };
        
        shaders.forEach(shader => {
            discoveredShaders.add(shader);
            const shaderInfo = extractShaderInfo(shader);
            programInfo.shaders.push(shaderInfo);
            capturedData.shaders.push(shaderInfo);
        });
        
        capturedData.programs.push(programInfo);
    });
    
    return capturedData;
}

// Function to print results nicely
function printShaders() {
    const data = extractAllShaders();
    console.log(`Found ${discoveredPrograms.size} program(s) and ${discoveredShaders.size} shader(s)\n`);
    
    data.programs.forEach((prog, idx) => {
        console.log(`\n========== PROGRAM ${idx} ==========`);
        console.log(`Active: ${prog.active}, Linked: ${prog.linked}`);
        
        prog.shaders.forEach((shader, sIdx) => {
            console.log(`\n--- ${shader.type} ---`);
            console.log(shader.source);
        });
    });
    
    return data;
}

console.log('WebGL2 context instrumented! Interacting with the canvas now...');
console.log('Call printShaders() to see all captured shaders');
console.log('Or call extractAllShaders() to get the data object');

// Auto-capture after a short delay to catch initial render
setTimeout(() => {
    console.log('\n=== AUTO-CAPTURE RESULTS ===');
    printShaders();
}, 1000);
