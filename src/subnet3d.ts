// 3D block grid of a network split into subnets, drawn with three.js

import * as THREE from 'three';
import type { GridPosition } from './subnet';

export interface Cell {
  color: number;
  height: number;
  label: string;
  group: number;  // index of the subnet the cell belongs to
  position: GridPosition;
}

interface GroupLabel {
  group: number;
  element: HTMLElement;
  position: THREE.Vector3;
}

type Block = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

const blockSpacing = 1.15;
// extra space between subnet tiles
const tileGap = 1.2;

export class SubnetScene {
  // called with the subnet under the pointer, or -1
  onHoverGroup: (group: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private grid = new THREE.Group();
  // base at y=0 so scaling y grows the block upwards
  private geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private blocks: Block[] = [];
  private heights: number[] = [];
  private labels: string[] = [];
  private groups: number[] = [];
  private groupLabels: GroupLabel[] = [];
  private highlighted = -1;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private azimuth = 0.4;
  private polar = 0.95;
  private distance = 30;
  private currentDistance = 30;
  private frame = 0;

  // throws when WebGL is unavailable
  constructor(private container: HTMLElement, private tooltip: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1c1c);
    container.appendChild(this.renderer.domElement);

    // intensities scaled by π to match the look from before three.js switched to physical light units
    const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
    sun.position.set(10, 20, 14);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55 * Math.PI), sun, this.grid);

    new ResizeObserver(() => this.resize()).observe(container);
    this.bindPointer();
  }

  // groupLabels holds one label per subnet tile ('' for none), or is empty to show none
  update(cells: Cell[], groupLabels: string[]): void {
    const x = (cell: Cell): number => cell.position.col * blockSpacing + cell.position.gapCols * tileGap;
    const z = (cell: Cell): number => cell.position.row * blockSpacing + cell.position.gapRows * tileGap;
    const width = Math.max(...cells.map(x));
    const depth = Math.max(...cells.map(z));

    cells.forEach((cell, i) => {
      const block = this.blocks[i] ?? this.addBlock();
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
  highlightGroup(group: number): void {
    this.highlighted = group;
    this.blocks.forEach((block, i) => block.material.emissive.setHex(this.groups[i] === group ? 0x555555 : 0x000000));
    this.groupLabels.forEach(label => label.element.classList.toggle('active', label.group === group));
    this.requestRender();
  }

  // a label floats above the middle of each tile
  private setGroupLabels(cells: Cell[], texts: string[]): void {
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

  private addBlock(): Block {
    const block = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    block.scale.y = 0.01;
    this.grid.add(block);
    this.blocks.push(block);
    return block;
  }

  private requestRender(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => this.render());
    }
  }

  // eases block heights and camera distance towards their targets, rendering until they settle
  private render(): void {
    this.frame = 0;
    let settled = true;

    const ease = (current: number, target: number): number => {
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
  private placeGroupLabels(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    const projected = new THREE.Vector3();

    this.groupLabels.forEach(({ element, position }) => {
      projected.copy(position).project(this.camera);
      element.hidden = projected.z > 1;
      element.style.left = `${(projected.x + 1) / 2 * width}px`;
      element.style.top = `${(1 - projected.y) / 2 * height}px`;
    });
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  // drag to orbit, hover a block for its label
  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    let drag: { x: number; y: number } | null = null;

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
      } else {
        this.hover(e);
      }
    });
  }

  private hover(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects(this.blocks.filter(block => block.visible))[0];
    const index = hit ? this.blocks.indexOf(hit.object as Block) : -1;
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

  private setHovered(index: number): void {
    const group = index >= 0 ? this.groups[index] : -1;
    this.tooltip.hidden = index < 0;

    if (group !== this.highlighted) {
      this.highlightGroup(group);
      this.onHoverGroup(group);
    }
  }
}
