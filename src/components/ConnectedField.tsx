import { Maximize, Minus, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { documentDomain, searchableText } from "../search/index";
import { tokenize } from "../search/tokenizer";
import type { DocumentRecord } from "../search/types";

type Props = {
	documents: DocumentRecord[];
	selectedId: string;
	onSelect: (document: DocumentRecord) => void;
};

type Point = { x: number; y: number };

const NODE_COLORS = ["#70ffe1", "#9cecff", "#ffbd79", "#d6ff9d"];

function sharedTerms(left: DocumentRecord, right: DocumentRecord): number {
	const rightTerms = new Set(tokenize(searchableText(right)));
	return tokenize(searchableText(left)).reduce(
		(count, term) => count + Number(rightTerms.has(term)),
		0,
	);
}

function positionsFor(documents: DocumentRecord[]): Map<string, Point> {
	const positions = new Map<string, Point>();
	const columns = documents.length > 8 ? 4 : 3;
	const rows = Math.max(1, Math.ceil(documents.length / columns));
	documents.forEach((document, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		positions.set(document.id, {
			x: 12 + column * (76 / (columns - 1)),
			y: rows === 1 ? 50 : 18 + row * (64 / (rows - 1)),
		});
	});
	return positions;
}

export default function ConnectedField({
	documents,
	selectedId,
	onSelect,
}: Props) {
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
	const [dragStart, setDragStart] = useState<Point | null>(null);
	const viewportRef = useRef<SVGSVGElement>(null);
	const positions = useMemo(() => positionsFor(documents), [documents]);
	const height = 100;

	function zoomBy(amount: number) {
		setZoom((value) => Math.min(1.35, Math.max(0.78, value + amount)));
	}

	function startPan(event: React.PointerEvent<SVGSVGElement>) {
		if ((event.target as Element).closest(".string-node")) return;
		setDragStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function movePan(event: React.PointerEvent<SVGSVGElement>) {
		if (!dragStart) return;
		setPan({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y });
	}

	return (
		<div className="string-field">
			<svg
				ref={viewportRef}
				className="string-canvas"
				viewBox={`0 0 100 ${height}`}
				role="img"
				aria-label={`Connected search result field with ${documents.length} results. Select a node to inspect it.`}
				onPointerDown={startPan}
				onPointerMove={movePan}
				onPointerUp={() => setDragStart(null)}
				onPointerCancel={() => setDragStart(null)}
				onWheel={(event) => {
					event.preventDefault();
					zoomBy(event.deltaY < 0 ? 0.05 : -0.05);
				}}
			>
				<g
					transform={`translate(${pan.x / 8} ${pan.y / 8}) translate(50 ${height / 2}) scale(${zoom}) translate(-50 ${-height / 2})`}
				>
					<path className="field-axis" d={`M 5 ${height / 2} H 95`} />
					{documents.flatMap((left, leftIndex) =>
						documents.slice(leftIndex + 1).map((right) => {
							const leftPoint = positions.get(left.id);
							const rightPoint = positions.get(right.id);
							if (!leftPoint || !rightPoint) return null;
							const sameDomain = documentDomain(left) === documentDomain(right);
							const sharedEntity = left.entities.some((entity) =>
								right.entities.some(
									(candidate) =>
										candidate.toLocaleLowerCase() ===
										entity.toLocaleLowerCase(),
								),
							);
							const terms = sharedTerms(left, right);
							if (!sameDomain && !sharedEntity && terms < 3) return null;
							const curve = (leftPoint.y + rightPoint.y) / 2;
							return (
								<path
									key={`${left.id}-${right.id}`}
									className={`field-string${sameDomain ? " domain-string" : sharedEntity ? " entity-string" : " term-string"}`}
									d={`M ${leftPoint.x} ${leftPoint.y} Q 50 ${curve} ${rightPoint.x} ${rightPoint.y}`}
								/>
							);
						}),
					)}
					{documents.map((document, index) => {
						const point = positions.get(document.id);
						if (!point) return null;
						const selected = document.id === selectedId;
						return (
							// biome-ignore lint/a11y/useSemanticElements: SVG geometry provides the node hit area.
							<g
								className={`string-node${selected ? " selected" : ""}`}
								key={document.id}
								transform={`translate(${point.x} ${point.y})`}
								role="button"
								tabIndex={0}
								aria-label={`${index + 1}. ${document.title}`}
								aria-pressed={selected}
								onClick={() => onSelect(document)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect(document);
									}
								}}
							>
								<circle
									className={`string-node-halo string-color-${index % NODE_COLORS.length}`}
									r={2.4}
								/>
								<circle
									className={`string-node-dot string-color-${index % NODE_COLORS.length}`}
									r={selected ? 1.05 : 0.75}
								/>
								<text className="string-node-number" x="-1.8" y="-4.5">
									{String(index + 1).padStart(2, "0")}
								</text>
								<text className="string-node-label" x="4" y="0.8">
									{document.title.length > 25
										? `${document.title.slice(0, 22)}...`
										: document.title}
								</text>
								<text className="string-node-domain" x="4" y="3.2">
									{documentDomain(document)}
								</text>
							</g>
						);
					})}
				</g>
			</svg>
			<div className="string-readout" aria-live="polite">
				<span>{String(documents.length).padStart(2, "0")} NODES</span>
				<span>CONNECTED FIELD</span>
				<span>ZOOM {Math.round(zoom * 100)}%</span>
			</div>
			<fieldset className="string-controls">
				<legend className="visually-hidden">Connected field controls</legend>
				<button
					type="button"
					aria-label="Zoom in"
					title="Zoom in"
					onClick={() => zoomBy(0.08)}
				>
					<Plus size={14} />
				</button>
				<button
					type="button"
					aria-label="Zoom out"
					title="Zoom out"
					onClick={() => zoomBy(-0.08)}
				>
					<Minus size={14} />
				</button>
				<button
					type="button"
					aria-label="Center field"
					title="Center field"
					onClick={() => {
						setPan({ x: 0, y: 0 });
						setZoom(1);
					}}
				>
					<Maximize size={13} />
				</button>
			</fieldset>
		</div>
	);
}
