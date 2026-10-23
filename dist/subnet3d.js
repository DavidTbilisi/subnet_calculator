"use strict";
// 3D block grid of a network split into subnets, drawn with three.js (loaded from the CDN as a global)
const blockSpacing = 1.15;
// extra space between subnet tiles
const tileGap = 1.2;
class SubnetScene {
    // throws when WebGL is unavailable
    constructor(container, tooltip) {
        this.container = container;
        this.tooltip = tooltip;
        // called with the subnet under the pointer, or -1
        this.onHoverGroup = () => { };
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
        this.grid = new THREE.Group();
        // base at y=0 so scaling y grows the block upwards
        this.geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        this.blocks = [];
        this.heights = [];
        this.labels = [];
        this.groups = [];
        this.groupLabels = [];
        this.highlighted = -1;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.azimuth = 0.4;
        this.polar = 0.95;
        this.distance = 30;
        this.currentDistance = 30;
        this.frame = 0;
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x1a1c1c);
        container.appendChild(this.renderer.domElement);
        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(10, 20, 14);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.55), sun, this.grid);
        new ResizeObserver(() => this.resize()).observe(container);
        this.bindPointer();
    }
    // groupLabels holds one label per subnet tile ('' for none), or is empty to show none
    update(cells, groupLabels) {
        const x = (cell) => cell.position.col * blockSpacing + cell.position.gapCols * tileGap;
        const z = (cell) => cell.position.row * blockSpacing + cell.position.gapRows * tileGap;
        const width = Math.max(...cells.map(x));
        const depth = Math.max(...cells.map(z));
        cells.forEach((cell, i) => {
            var _a;
            const block = (_a = this.blocks[i]) !== null && _a !== void 0 ? _a : this.addBlock();
            block.visible = true;
            block.position.set(x(cell) - width / 2, 0, z(cell) - depth / 2);
            block.material.color.setHex(cell.color);
            this.heights[i] = cell.height;
            this.labels[i] = cell.label;
            this.groups[i] = cell.group;
        });
        this.blocks.slice(cells.length).forEach(block => block.visible = false);
        this.groups.length = cells.length;
        this.setGroupLabels(cells, groupLabels);
        this.highlightGroup(-1);
        this.distance = Math.max(width, depth) * 1.4 + 5;
        this.requestRender();
    }
    // lights up every block of a subnet; -1 clears the highlight
    highlightGroup(group) {
        this.highlighted = group;
        this.blocks.forEach((block, i) => block.material.emissive.setHex(this.groups[i] === group ? 0x555555 : 0x000000));
        this.groupLabels.forEach(label => label.element.classList.toggle('active', label.group === group));
        this.requestRender();
    }
    // a label floats above the middle of each tile
    setGroupLabels(cells, texts) {
        this.groupLabels.forEach(label => label.element.remove());
        this.groupLabels = [];
        texts.forEach((text, group) => {
            if (text === '') {
                return;
            }
            const members = this.blocks.filter((_, i) => this.groups[i] === group);
            const position = new THREE.Vector3();
            members.forEach(block => position.add(block.position));
            position.divideScalar(members.length);
            position.y = Math.max(...cells.filter(cell => cell.group === group).map(cell => cell.height)) + 0.4;
            const element = document.createElement('div');
            element.className = 'subnet-label';
            element.textContent = text;
            this.container.appendChild(element);
            this.groupLabels.push({ group, element, position });
        });
    }
    addBlock() {
        const block = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
        block.scale.y = 0.01;
        this.grid.add(block);
        this.blocks.push(block);
        return block;
    }
    requestRender() {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => this.render());
        }
    }
    // eases block heights and camera distance towards their targets, rendering until they settle
    render() {
        this.frame = 0;
        let settled = true;
        const ease = (current, target) => {
            if (Math.abs(target - current) < 0.005) {
                return target;
            }
            settled = false;
            return current + (target - current) * 0.15;
        };
        this.blocks.forEach((block, i) => {
            if (block.visible) {
                block.scale.y = ease(block.scale.y, this.heights[i]);
            }
        });
        this.currentDistance = ease(this.currentDistance, this.distance);
        // back off on narrow screens so the grid still fits horizontally
        const distance = this.currentDistance / Math.min(this.camera.aspect, 1);
        this.camera.position.setFromSphericalCoords(distance, this.polar, this.azimuth);
        this.camera.lookAt(0, 1, 0);
        this.renderer.render(this.scene, this.camera);
        this.placeGroupLabels();
        if (!settled) {
            this.requestRender();
        }
    }
    // project each tile label onto the canvas
    placeGroupLabels() {
        const { clientWidth: width, clientHeight: height } = this.container;
        const projected = new THREE.Vector3();
        this.groupLabels.forEach(({ element, position }) => {
            projected.copy(position).project(this.camera);
            element.hidden = projected.z > 1;
            element.style.left = `${(projected.x + 1) / 2 * width}px`;
            element.style.top = `${(1 - projected.y) / 2 * height}px`;
        });
    }
    resize() {
        const { clientWidth: width, clientHeight: height } = this.container;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }
    // drag to orbit, hover a block for its label
    bindPointer() {
        const canvas = this.renderer.domElement;
        let drag = null;
        canvas.addEventListener('pointerdown', e => {
            drag = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
            this.setHovered(-1);
        });
        canvas.addEventListener('pointerup', () => drag = null);
        canvas.addEventListener('pointercancel', () => drag = null);
        canvas.addEventListener('pointerleave', () => this.setHovered(-1));
        canvas.addEventListener('pointermove', e => {
            if (drag) {
                this.azimuth -= (e.clientX - drag.x) * 0.01;
                this.polar = Math.min(Math.max(this.polar - (e.clientY - drag.y) * 0.01, 0.2), 1.45);
                drag = { x: e.clientX, y: e.clientY };
                this.requestRender();
            }
            else {
                this.hover(e);
            }
        });
    }
    hover(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObjects(this.blocks.filter(block => block.visible))[0];
        const index = hit ? this.blocks.indexOf(hit.object) : -1;
        this.setHovered(index);
        if (index >= 0) {
            this.tooltip.textContent = this.labels[index];
            // keep the tooltip inside the canvas
            const x = Math.min(e.clientX - rect.left + 14, rect.width - this.tooltip.offsetWidth - 4);
            const y = Math.min(e.clientY - rect.top + 14, rect.height - this.tooltip.offsetHeight - 4);
            this.tooltip.style.left = `${x}px`;
            this.tooltip.style.top = `${y}px`;
        }
    }
    setHovered(index) {
        const group = index >= 0 ? this.groups[index] : -1;
        this.tooltip.hidden = index < 0;
        if (group !== this.highlighted) {
            this.highlightGroup(group);
            this.onHoverGroup(group);
        }
    }
}
