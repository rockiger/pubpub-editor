import React, { Component } from 'react';
import PropTypes from 'prop-types';
import LatexEditable from './LatexEditable';
import LatexStatic from './LatexStatic';

/*
All addons get the following props,
but certain schema-based addons may not need them
*/

const propTypes = {
	renderFunction: PropTypes.func.isRequired,
	// containerId: PropTypes.string.isRequired,
	// view: PropTypes.object.isRequired,
	// editorState: PropTypes.object.isRequired,
};

class LatexAddon extends Component {
	static schema = (props)=> {
		return {
			nodes: {
				equation: {
					atom: true,
					group: 'inline',
					content: 'inline*',
					attrs: {
						value: { default: '' },
						html: { default: '' },
					},
					parseDOM: [{
						tag: 'math',
						getAttrs: (node)=> {
							return {
								value: node.getAttribute('data-value') || '',
								html: node.getAttribute('data-html') || '',
							};
						}
					}],
					toDOM: (node)=> {
						return ['math', {
							'data-value': node.attrs.value,
							'data-html': node.attrs.html,
						}];
					},
					inline: true,
					draggable: false,
					selectable: true,
					insertMenu: {
						label: 'Insert Latex Math',
						icon: 'pt-icon-function',
						onInsert: (view) => {
							const newNode = view.state.schema.nodes.equation.create({ 
								value: '\\sum_ix^i',
								html: '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><msub><mo>∑</mo><mi>i</mi></msub><msup><mi>x</mi><mi>i</mi></msup></mrow><annotation encoding="application/x-tex">\sum_ix^i</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="strut" style="height:0.824664em;"></span><span class="strut bottom" style="height:1.124374em;vertical-align:-0.29971000000000003em;"></span><span class="base"><span class="mop"><span class="mop op-symbol small-op" style="position:relative;top:-0.0000050000000000050004em;">∑</span><span class="msupsub"><span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist" style="height:0.16195399999999993em;"><span style="top:-2.40029em;margin-left:0em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="sizing reset-size6 size3 mtight"><span class="mord mathit mtight">i</span></span></span></span><span class="vlist-s">​</span></span><span class="vlist-r"><span class="vlist" style="height:0.29971000000000003em;"></span></span></span></span></span><span class="mord"><span class="mord mathit">x</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist" style="height:0.824664em;"><span style="top:-3.063em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="sizing reset-size6 size3 mtight"><span class="mord mathit mtight">i</span></span></span></span></span></span></span></span></span></span></span>',
							});
							view.dispatch(view.state.tr.replaceSelectionWith(newNode));
						},
					},
					toEditable(node, view, decorations, isSelected, helperFunctions) {
						return (
							<LatexEditable
								value={node.attrs.value}
								html={node.attrs.html}
								isBlock={false}
								isSelected={isSelected}
								view={view}
								renderFunction={props.renderFunction}
								{...helperFunctions}
							/>
						);
					},
					toStatic(node) {
						return (
							<LatexStatic
								// value={node.attrs.value}
								html={node.attrs.html}
								isBlock={false}
							/>
						);
					},
				},


				block_equation: {
					atom: true,
					group: 'block',
					content: 'inline*',
					draggable: false,
					selectable: true,
					attrs: {
						value: { default: '' },
					},
					toEditable(node, view, decorations, isSelected, helperFunctions) {
						return (
							<LatexEditable
								value={node.attrs.value}
								isBlock={true}
								isSelected={isSelected}
								view={view}
								{...helperFunctions}
							/>
						);
					},
					toStatic(node) {
						return <LatexStatic value={node.attrs.value} isBlock={true} />;
					}
				},
			}
		};
	};

	render() {
		return null;
	}
}

LatexAddon.propTypes = propTypes;
export default LatexAddon;
