// extract.js (WebGPU)
// Snapshot a tracked GPUDevice record into a JSON-safe object.

function idFor(record, resource, fallback) {
  return record.ids.get(resource) || fallback;
}

export function extractDevice(record) {
  return {
    label: record.device?.label || null,
    adapterInfo: record.adapterInfo || null,
    canvas: record.canvas ? {
      width: record.canvas.width, height: record.canvas.height,
      id: record.canvas.id || null,
    } : null,
    canvasFormat: record.canvasFormat || null,
    frame: {
      fps: record.frame.fps,
      frameMs: record.frame.frameMs,
      drawCalls: record.frame.drawCalls,
      dispatchCalls: record.frame.dispatchCalls,
      vertices: record.frame.vertices,
      triangles: record.frame.triangles,
      lines: record.frame.lines,
      points: record.frame.points,
      renderPasses: record.frame.renderPasses,
      computePasses: record.frame.computePasses,
      submits: record.frame.submits,
      copies: record.frame.copies,
      workgroups: record.frame.workgroups,
      writeBuffer: record.frame.writeBuffer,
      writeTexture: record.frame.writeTexture,
      draws: record.frame.draws.slice(),
      dispatches: record.frame.dispatches.slice(),
      passes: (record.frame.passes || []).map((p) => ({ ...p })),
    },
    warnings: (record.warnings || []).map((w) => ({
      severity: w.severity, source: w.source, kind: w.kind,
      message: w.message, count: w.count, time: w.time, refs: w.refs || null,
    })),
    totals: { ...record.totals },
    inventory: {
      buffers: record.buffers.size,
      textures: record.textures.size,
      samplers: record.samplers.size,
      shaderModules: record.shaderModules.size,
      bindGroups: record.bindGroups.size,
      bindGroupLayouts: record.bindGroupLayouts.size,
      pipelineLayouts: record.pipelineLayouts.size,
      renderPipelines: record.renderPipelines.size,
      computePipelines: record.computePipelines.size,
      querySets: record.querySets.size,
      externalTextures: record.externalTextures.size,
      buffersByKind: bufferBreakdown(record),
    },
    buffers: extractBuffers(record),
    textures: extractTextures(record),
    samplers: extractSamplers(record),
    shaderModules: extractShaderModules(record),
    renderPipelines: extractRenderPipelines(record),
    computePipelines: extractComputePipelines(record),
    bindGroupLayouts: extractBindGroupLayouts(record),
    bindGroups: extractBindGroups(record),
  };
}

function bufferBreakdown(record) {
  const by = { VERTEX: 0, INDEX: 0, UNIFORM: 0, STORAGE: 0, INDIRECT: 0, OTHER: 0 };
  for (const [, info] of record.buffers) {
    const flags = info.usageFlags || [];
    if (flags.includes("VERTEX")) by.VERTEX++;
    else if (flags.includes("INDEX")) by.INDEX++;
    else if (flags.includes("UNIFORM")) by.UNIFORM++;
    else if (flags.includes("STORAGE")) by.STORAGE++;
    else if (flags.includes("INDIRECT")) by.INDIRECT++;
    else by.OTHER++;
  }
  return by;
}

function extractBuffers(record) {
  const out = [];
  for (const [b, info] of record.buffers) {
    out.push({
      id: idFor(record, b, "b?"),
      label: info.label,
      size: info.size,
      usageFlags: info.usageFlags,
      mappedAtCreation: info.mappedAtCreation,
    });
  }
  return out;
}

function extractTextures(record) {
  const out = [];
  for (const [t, info] of record.textures) {
    out.push({
      id: idFor(record, t, "t?"),
      label: info.label,
      width: info.width, height: info.height,
      depthOrArrayLayers: info.depthOrArrayLayers,
      format: info.format,
      dimension: info.dimension,
      mipLevelCount: info.mipLevelCount,
      sampleCount: info.sampleCount,
      usageFlags: info.usageFlags,
    });
  }
  return out;
}

function extractSamplers(record) {
  const out = [];
  for (const [s, info] of record.samplers) {
    out.push({ id: idFor(record, s, "s?"), ...info });
  }
  return out;
}

function extractShaderModules(record) {
  const out = [];
  for (const [m, info] of record.shaderModules) {
    out.push({
      id: idFor(record, m, "sh?"),
      label: info.label,
      sourceLength: info.sourceLength,
      code: info.code,
    });
  }
  return out;
}

function extractRenderPipelines(record) {
  const out = [];
  for (const [p, info] of record.renderPipelines) {
    out.push({
      id: idFor(record, p, "rp?"),
      label: info.label,
      topology: info.topology,
      cullMode: info.cullMode,
      frontFace: info.frontFace,
      layoutKind: info.layoutKind,
      vertex: info.vertex,
      fragment: info.fragment,
      depthStencil: info.depthStencil,
      multisample: info.multisample,
      drawsF: info._drawsF || 0,
      vertsF: info._vertsF || 0,
      totalDraws: info._totalDraws || 0,
      totalVerts: info._totalVerts || 0,
    });
  }
  return out;
}

function extractComputePipelines(record) {
  const out = [];
  for (const [p, info] of record.computePipelines) {
    out.push({
      id: idFor(record, p, "cp?"),
      label: info.label,
      layoutKind: info.layoutKind,
      compute: info.compute,
      dispatchesF: info._dispatchesF || 0,
      wgF: info._wgF || 0,
      totalDispatches: info._totalDispatches || 0,
      totalWorkgroups: info._totalWorkgroups || 0,
    });
  }
  return out;
}

function extractBindGroupLayouts(record) {
  const out = [];
  for (const [l, info] of record.bindGroupLayouts) {
    out.push({
      id: idFor(record, l, "bgl?"),
      label: info.label,
      explicit: info.explicit,
      entries: info.entries,
    });
  }
  return out;
}

function extractBindGroups(record) {
  const out = [];
  for (const [g, info] of record.bindGroups) {
    out.push({
      id: idFor(record, g, "bg?"),
      label: info.label,
      layoutId: info.layoutId,
      entries: (info.entries || []).map((e) => ({
        binding: e.binding,
        resource: cleanResource(e.resource),
      })),
    });
  }
  return out;
}

// Strip non-JSON-safe fields (raw GPUBuffer object kept for static validation)
function cleanResource(res) {
  if (!res) return null;
  if (res.kind === "bufferBinding") {
    return { kind: res.kind, bufferId: res.bufferId, offset: res.offset, size: res.size };
  }
  return { ...res };
}
