/**
 * JSXGraph 2D 通用模板（课件用）
 *
 * 用法：
 *   const { board } = JXGKit2D.mount('box', { boundingbox: [-5, 5, 5, -5] });
 *   JXGKit2D.draw(board, {
 *     points: { A: [0, 2], B: [-2, 0], C: [2, 0] },
 *     segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
 *     polygons: [{ vertices: ['A', 'B', 'C'], fillColor: '#3b82f6', fillOpacity: 0.25 }]
 *   });
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JXGKit2D = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BOARD = {
    boundingbox: [-5, 5, 5, -5],
    axis: false,
    grid: false,
    showCopyright: false,
    showNavigation: false,
    keepAspectRatio: true,
    pan: { enabled: false }
  };

  var DEFAULT_POINT = {
    size: 2.5,
    fixed: true,
    highlight: false,
    showInfobox: false
  };

  var DEFAULT_SEGMENT = {
    strokeColor: '#1e293b',
    strokeWidth: 2,
    fixed: true,
    highlight: false
  };

  function assign() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
      }
    }
    return out;
  }

  /**
   * 屏幕习惯写 $...$；JSXGraph useKatex 要裸 TeX。
   * 明文符号（△ABD / cm²）保持 useKatex:false。
   * @returns {{ text: string|*, useKatex: boolean }}
   */
  function normalizeFigureText(raw) {
    if (typeof raw !== 'string') {
      return { text: raw, useKatex: false };
    }
    var text = raw;
    var useKatex = false;
    var m = text.match(/^\$\$([\s\S]*)\$\$$/) || text.match(/^\$([\s\S]*)\$$/);
    if (m) {
      text = m[1];
      useKatex = true;
    } else if (/\\[a-zA-Z]+/.test(text)) {
      useKatex = true;
    }
    return { text: text, useKatex: useKatex };
  }

  /** \\frac{a}{b} → a/b，KaTeX 不可用时的图上 label 兜底 */
  function texFractionToPlain(tex) {
    if (typeof tex !== 'string') return tex;
    var m = tex.match(/^\\frac\{([^}]*)\}\{([^}]*)\}$/);
    return m ? m[1] + '/' + m[2] : tex;
  }

  /**
   * 在 board 上创建文字标注（figure.actions label 统一入口）。
   * 去 $ 定界、按需 KaTeX；库未就绪时 \\frac 退化为 a/b，禁止原样显示 $...$。
   * @returns {object} JSXGraph text element
   */
  function createBoardLabel(board, x, y, rawText, attrs) {
    var norm = normalizeFigureText(rawText);
    var text = norm.text;
    var useKatex = norm.useKatex;
    if (useKatex && typeof katex === 'undefined') {
      text = texFractionToPlain(text);
      useKatex = false;
    }
    return board.create('text', [x, y, text], assign({
      fixed: true,
      highlight: false,
      fontSize: 14,
      useKatex: useKatex,
      anchorX: 'middle'
    }, attrs || {}));
  }

  /* ---------- figure.state / figure.actions 执行（生成模块与手写 Figure 共用） ---------- */

  var HIGHLIGHT_COLOR = '#f59e0b';
  var DIM_STYLE = { strokeOpacity: 0.15, fillOpacity: 0.05 };
  var BASE_KEYS = ['visible', 'strokeColor', 'strokeWidth', 'strokeOpacity', 'fillColor', 'fillOpacity', 'withLabel'];

  function forEachElement(els, fn) {
    Object.keys(els || {}).forEach(function (key) {
      if (key === '_dynamic') return;
      var collection = els[key];
      if (Array.isArray(collection)) {
        collection.forEach(function (el) { fn(el, el && el.name); });
      } else if (collection && typeof collection === 'object') {
        Object.keys(collection).forEach(function (id) { fn(collection[id], id); });
      }
    });
  }

  function resolveTarget(els, id) {
    var found = null;
    forEachElement(els, function (el, key) {
      if (!found && (key === id || (el && (el.name === id || el.id === id)))) found = el;
    });
    return found;
  }

  function readBaseAttrs(el) {
    var visProp = (el && el.visProp) || {};
    var attrs = {};
    BASE_KEYS.forEach(function (key) {
      var value = visProp[key.toLowerCase()];
      if (value !== undefined) attrs[key] = value;
    });
    return attrs;
  }

  /** 绘制完成后调用，记录每个构件的初始样式，供状态切换时复位。 */
  function captureBase(els) {
    var base = {};
    forEachElement(els, function (el, id) {
      if (el && id != null && base[id] == null) base[id] = readBaseAttrs(el);
    });
    return base;
  }

  function setVisible(el, visible) {
    el.setAttribute({ visible: visible });
    if (visible && typeof el.showElement === 'function') el.showElement();
    if (!visible && typeof el.hideElement === 'function') el.hideElement();
  }

  // 只恢复描边/填充，绝不改 visible：否则复位会把已显示的路线藏起来再画出，整图闪一下
  function styleFromBase(baseAttrs) {
    var out = {};
    if (!baseAttrs) return out;
    ['strokeColor', 'strokeWidth', 'strokeOpacity', 'fillColor', 'fillOpacity'].forEach(function (key) {
      if (baseAttrs[key] !== undefined) out[key] = baseAttrs[key];
    });
    return out;
  }

  function highlightAttrs(el, baseAttrs) {
    var width = baseAttrs && typeof baseAttrs.strokeWidth === 'number' ? baseAttrs.strokeWidth + 1.5 : 4;
    var attrs = { strokeColor: HIGHLIGHT_COLOR, strokeWidth: width, strokeOpacity: 1 };
    // 点/线没有填充概念，多设 fillColor 无害；多边形依赖它显色
    attrs.fillColor = HIGHLIGHT_COLOR;
    if (el && el.elType === 'polygon') {
      var baseFill = baseAttrs && typeof baseAttrs.fillOpacity === 'number' ? baseAttrs.fillOpacity : 0.25;
      attrs.fillOpacity = Math.max(baseFill, 0.4);
    }
    return attrs;
  }

  /** 复位全部构件到 captureBase 样式，并清掉运行期动态补画的标签。 */
  function resetFigure(board, els, base) {
    (els._dynamic || []).forEach(function (el) {
      if (board && typeof board.removeObject === 'function') board.removeObject(el);
    });
    els._dynamic = [];
    forEachElement(els, function (el, id) {
      var attrs = (base && base[id]) || null;
      if (el && attrs) el.setAttribute(attrs);
    });
  }

  function normalizeTargets(field) {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    if (Array.isArray(field.targets)) return field.targets;
    return [];
  }

  /** 应用 spec.states[state] 声明的视觉状态（show/availableTargets/hide/highlight/dim）。 */
  function applyStateDef(board, els, stateDef, base) {
    if (!stateDef) return;
    normalizeTargets(stateDef.hide).forEach(function (id) {
      var el = resolveTarget(els, id);
      if (el) setVisible(el, false);
      else console.error('[JXGKit2D] state 引用未知目标: ' + id);
    });
    normalizeTargets(stateDef.show).concat(normalizeTargets(stateDef.availableTargets)).forEach(function (id) {
      var el = resolveTarget(els, id);
      if (el) setVisible(el, true);
      else console.error('[JXGKit2D] state 引用未知目标: ' + id);
    });
    normalizeTargets(stateDef.dim).forEach(function (id) {
      var el = resolveTarget(els, id);
      if (el) el.setAttribute(DIM_STYLE);
      else console.error('[JXGKit2D] state 引用未知目标: ' + id);
    });
    normalizeTargets(stateDef.highlight).forEach(function (id) {
      var el = resolveTarget(els, id);
      if (el) el.setAttribute(highlightAttrs(el, base && base[id]));
      else console.error('[JXGKit2D] state 引用未知目标: ' + id);
    });
  }

  function labelPosition(el) {
    if (el && typeof el.X === 'function' && typeof el.Y === 'function') return [el.X(), el.Y()];
    if (el && el.point1 && el.point2) {
      return [(el.point1.X() + el.point2.X()) / 2, (el.point1.Y() + el.point2.Y()) / 2];
    }
    return null;
  }

  function blinkElement(el, baseAttrs) {
    var onAttrs = highlightAttrs(el, baseAttrs);
    var offAttrs = baseAttrs || {};
    var ticks = 0;
    el.setAttribute(onAttrs);
    var timer = setInterval(function () {
      ticks++;
      if (ticks >= 6) {
        clearInterval(timer);
        el.setAttribute(offAttrs);
        return;
      }
      el.setAttribute(ticks % 2 ? offAttrs : onAttrs);
    }, 220);
  }

  function withBoardPaused(board, fn) {
    var paused = false;
    if (board && typeof board.suspendUpdate === 'function') {
      board.suspendUpdate();
      paused = true;
    }
    try { fn(); }
    finally {
      if (paused && board && typeof board.unsuspendUpdate === 'function') board.unsuspendUpdate();
    }
  }

  // highlightSeq / highlightRotate：分组顺序高亮（路线动画）
  // targets 为数组的数组（每组一批元素），按组依次高亮；rotate 时每组点亮前先熄灭上一组
  function runHighlightSequence(board, els, action, base, rotate) {
    var delay = typeof action.delay === 'number' ? action.delay : 1200;
    var startDelay = typeof action.startDelay === 'number' ? action.startDelay : 450;
    var groups = normalizeTargets(action.targets).map(function (t) { return Array.isArray(t) ? t : [t]; });
    board._animGen = (board._animGen || 0) + 1;
    var gen = board._animGen;
    var prev = [];

    function paintGroup(group, highlight) {
      withBoardPaused(board, function () {
        group.forEach(function (id) {
          var el = resolveTarget(els, id);
          if (!el) {
            console.error('[JXGKit2D] action highlightSeq 引用未知目标: ' + id);
            return;
          }
          if (highlight) {
            el.setAttribute(highlightAttrs(el, base && base[id]));
            prev.push({ id: id, el: el });
          } else {
            el.setAttribute(styleFromBase(base && base[id]));
          }
        });
      });
    }

    groups.forEach(function (group, gi) {
      setTimeout(function () {
        if (board._animGen !== gen) return;
        if (rotate && prev.length) {
          withBoardPaused(board, function () {
            prev.forEach(function (entry) {
              entry.el.setAttribute(styleFromBase(base && base[entry.id]));
            });
            prev = [];
          });
        }
        paintGroup(group, true);
      }, startDelay + gi * delay);
    });
  }

  /**
   * 按数组顺序执行 plan 的 figure.actions[]。
   * 目标按 spec 稳定构件 id 解析；未知 op / 目标报 console.error，不静默跳过。
   */
  function runActions(board, els, actions, base) {
    (actions || []).forEach(function (action) {
      if (!action) return;
      var op = action.op || action.type;
      if (op === 'highlightSeq') { runHighlightSequence(board, els, action, base, false); return; }
      if (op === 'highlightRotate') { runHighlightSequence(board, els, action, base, true); return; }
      var ids = normalizeTargets(action.targets && action.targets.length ? action.targets : null)
        .concat(action.target ? [action.target] : []);
      var resolved = ids.map(function (id) {
        var el = resolveTarget(els, id);
        if (!el) console.error('[JXGKit2D] action ' + op + ' 引用未知目标: ' + id);
        return { id: id, el: el };
      }).filter(function (entry) { return entry.el; });

      switch (op) {
        case 'show':
        case 'draw':
          resolved.forEach(function (entry) { setVisible(entry.el, true); });
          break;
        case 'hide':
          resolved.forEach(function (entry) { setVisible(entry.el, false); });
          break;
        case 'highlight':
          resolved.forEach(function (entry) {
            entry.el.setAttribute(highlightAttrs(entry.el, base && base[entry.id]));
          });
          break;
        case 'dim':
          resolved.forEach(function (entry) { entry.el.setAttribute(DIM_STYLE); });
          break;
        case 'color':
          resolved.forEach(function (entry) {
            var attrs = {};
            var color = action.color || action.strokeColor;
            if (color) attrs.strokeColor = color;
            if (action.fillColor || color) attrs.fillColor = action.fillColor || color;
            entry.el.setAttribute(attrs);
          });
          break;
        case 'blink':
          resolved.forEach(function (entry) { blinkElement(entry.el, base && base[entry.id]); });
          break;
        case 'label':
          if (action.text != null) {
            var anchorEl = typeof action.at === 'string'
              ? resolveTarget(els, action.at)
              : (resolved[0] && resolved[0].el);
            var pos = Array.isArray(action.at) ? action.at : labelPosition(anchorEl);
            if (!pos) {
              console.error('[JXGKit2D] action label 缺少可用位置（at 或可定位 target）');
              return;
            }
            // 幂等去重：同一位置同一文字的动态标签已存在时跳过。
            // 各拍 figureState 会把前面所有标签重复声明，重复创建会让同位置堆叠多个
            // HTML 覆盖层 div，创建瞬间整板重绘时新旧副本短暂错位 → 可见残影。
            var labelKey = String(action.text) + '@' + pos[0] + ',' + pos[1];
            var hasDup = false;
            (els._dynamic || []).forEach(function (el) {
              if (el && el.__labelKey === labelKey) hasDup = true;
            });
            if (!hasDup) {
              var labelEl = createBoardLabel(board, pos[0], pos[1], action.text, action.labelAttrs);
              labelEl.__labelKey = labelKey;
              if (!Array.isArray(els._dynamic)) els._dynamic = [];
              els._dynamic.push(labelEl);
            }
          } else {
            resolved.forEach(function (entry) {
              entry.el.setAttribute({ withLabel: true, visible: true });
              setVisible(entry.el, true);
            });
          }
          break;
        default:
          console.error('[JXGKit2D] 未知图形动作: ' + op);
      }
    });
  }

  /**
   * @param {string|HTMLElement} container
   * @param {object} [options] 传给 initBoard；可含 board 覆盖项
   * @returns {{ board: object }}
   */
  function mount(container, options) {
    if (typeof JXG === 'undefined') {
      throw new Error('JXGKit2D.mount: JSXGraph (JXG) is not loaded');
    }
    options = options || {};
    var boardOpts = assign({}, DEFAULT_BOARD, options.board || options);
    // 避免把非 board 字段误传入（如 points）
    delete boardOpts.points;
    delete boardOpts.segments;
    delete boardOpts.polygons;
    delete boardOpts.circles;
    delete boardOpts.texts;
    delete boardOpts.board;

    var board = JXG.JSXGraph.initBoard(container, boardOpts);
    return { board: board };
  }

  function resolvePoint(map, ref) {
    if (typeof ref === 'string') {
      if (!map[ref]) throw new Error('JXGKit2D: unknown point "' + ref + '"');
      return map[ref];
    }
    return ref;
  }

  /**
   * @param {object} board
   * @param {object} figure
   * @param {object} [figure.points] { name: [x,y] | { coords, ...attrs } }
   * @param {array}  [figure.segments] [ ['A','B'], { from:'A', to:'B', ... } ]
   * @param {array}  [figure.lines] 同 segments，但是无限直线 line
   * @param {array}  [figure.polygons]
   * @param {array}  [figure.circles] { center:'O', through:'A' } 或 { center, radius }
   * @param {array}  [figure.texts] { at:'A'| [x,y], text:'...' }
   * @returns {{ points, segments, lines, polygons, circles, texts }}
   */
  function draw(board, figure) {
    figure = figure || {};
    var points = {};
    var segments = {};
    var lines = {};
    var polygons = {};
    var circles = {};
    var arcs = {};
    var texts = {};

    var srcPoints = figure.points || {};
    Object.keys(srcPoints).forEach(function (name) {
      var raw = srcPoints[name];
      var coords;
      var attrs;
      if (Array.isArray(raw)) {
        coords = raw;
        attrs = {};
      } else {
        coords = raw.coords || raw.xy;
        attrs = assign({}, raw);
        delete attrs.coords;
        delete attrs.xy;
      }
      var labelSrc = attrs.name != null ? attrs.name : name;
      var labelNorm = normalizeFigureText(labelSrc);
      var pointAttrs = assign(
        {},
        DEFAULT_POINT,
        { name: typeof labelNorm.text === 'string' ? labelNorm.text : name, withLabel: !!name },
        attrs,
        { name: typeof labelNorm.text === 'string' ? labelNorm.text : name }
      );
      if (labelNorm.useKatex || attrs.useKatex) {
        pointAttrs.label = assign({}, pointAttrs.label, { useKatex: true });
      }
      points[name] = board.create('point', coords, pointAttrs);
    });

    function elementId(attrs, fallback) {
      if (attrs && attrs.id != null && attrs.id !== '') return String(attrs.id);
      if (attrs && attrs.name != null && attrs.name !== '') return String(attrs.name);
      return fallback;
    }

    function addEdge(item, type, sink, index) {
      var from;
      var to;
      var attrs = {};
      if (Array.isArray(item)) {
        from = item[0];
        to = item[1];
        attrs = item[2] || {};
      } else {
        from = item.from || item[0];
        to = item.to || item[1];
        attrs = assign({}, item);
        delete attrs.from;
        delete attrs.to;
      }
      var id = elementId(attrs, type + '-' + index);
      // JSXGraph 用 name 做稳定标识；spec 的 id 必须落到 name，否则 state.show 找不到
      if (attrs.name == null) attrs.name = id;
      var el = board.create(
        type,
        [resolvePoint(points, from), resolvePoint(points, to)],
        assign({}, DEFAULT_SEGMENT, attrs)
      );
      sink[id] = el;
    }

    (figure.segments || []).forEach(function (item, index) {
      addEdge(item, 'segment', segments, index);
    });
    (figure.lines || []).forEach(function (item, index) {
      addEdge(item, 'line', lines, index);
    });

    (figure.polygons || []).forEach(function (poly, index) {
      var vertNames = poly.vertices || poly.points || [];
      var verts = vertNames.map(function (v) {
        return resolvePoint(points, v);
      });
      var attrs = assign(
        {
          fillColor: '#3b82f6',
          fillOpacity: 0.25,
          borders: { strokeColor: '#1e293b', strokeWidth: 2 },
          fixed: true,
          highlight: false
        },
        poly
      );
      delete attrs.vertices;
      delete attrs.points;
      delete attrs.vertexStyle;
      attrs.vertices = poly.vertexStyle || { visible: false, fixed: true };
      var id = elementId(attrs, 'poly-' + index);
      if (attrs.name == null) attrs.name = id;
      polygons[id] = board.create('polygon', verts, attrs);
    });

    (figure.circles || []).forEach(function (cir, index) {
      var parents;
      if (cir.through != null) {
        parents = [resolvePoint(points, cir.center), resolvePoint(points, cir.through)];
      } else {
        parents = [resolvePoint(points, cir.center), cir.radius];
      }
      var attrs = assign(
        { strokeColor: '#1e293b', strokeWidth: 2, fixed: true, highlight: false },
        cir
      );
      delete attrs.center;
      delete attrs.through;
      delete attrs.radius;
      var id = elementId(attrs, 'cir-' + index);
      if (attrs.name == null) attrs.name = id;
      circles[id] = board.create('circle', parents, attrs);
    });

    (figure.arcs || []).forEach(function (arc, index) {
      var center = resolvePoint(points, arc.center);
      var from = resolvePoint(points, arc.from || arc.start);
      var to = resolvePoint(points, arc.to || arc.end);
      var attrs = assign(
        { strokeColor: '#1e293b', strokeWidth: 2, fixed: true, highlight: false },
        arc
      );
      delete attrs.center;
      delete attrs.from;
      delete attrs.start;
      delete attrs.to;
      delete attrs.end;
      var id = elementId(attrs, 'arc-' + index);
      if (attrs.name == null) attrs.name = id;
      arcs[id] = board.create('arc', [center, from, to], attrs);
    });

    (figure.texts || []).forEach(function (t, index) {
      var at = t.at;
      var norm = normalizeFigureText(t.text);
      var content = norm.text;
      var parents;
      if (typeof at === 'string') {
        var p = resolvePoint(points, at);
        parents = [function () { return p.X(); }, function () { return p.Y(); }, content];
      } else {
        parents = [at[0], at[1], content];
      }
      var attrs = assign(
        { fixed: true, highlight: false, fontSize: 14, useKatex: norm.useKatex },
        t,
        { useKatex: t.useKatex != null ? t.useKatex : norm.useKatex }
      );
      delete attrs.at;
      delete attrs.text;
      var id = elementId(attrs, 'text-' + index);
      if (attrs.name == null) attrs.name = id;
      texts[id] = board.create('text', parents, attrs);
    });

    return {
      points: points,
      segments: segments,
      lines: lines,
      polygons: polygons,
      circles: circles,
      arcs: arcs,
      texts: texts
    };
  }

  return {
    mount: mount,
    draw: draw,
    normalizeFigureText: normalizeFigureText,
    texFractionToPlain: texFractionToPlain,
    createBoardLabel: createBoardLabel,
    captureBase: captureBase,
    resetFigure: resetFigure,
    applyStateDef: applyStateDef,
    runActions: runActions,
    resolveTarget: resolveTarget,
    defaults: {
      board: DEFAULT_BOARD,
      point: DEFAULT_POINT,
      segment: DEFAULT_SEGMENT
    }
  };
});
