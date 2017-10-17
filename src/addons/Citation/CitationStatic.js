import React from 'react';
import PropTypes from 'prop-types';
import { Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';

require('./citationAddon.scss');

const propTypes = {
	value: PropTypes.string.isRequired,
	html: PropTypes.string.isRequired,
	count: PropTypes.number.isRequired,
};

const CitationStatic = function(props) {
	return (
		<div className={'citation-wrapper'}>
			<Popover
				content={
					<div className={'citation-text pt-card pt-elevation-2'}>
						{props.value &&
							<div
								dangerouslySetInnerHTML={{ __html: props.html }}
							/>
						}
						{!props.value &&
							<div className={'empty-citation-text'}>
								No Citation text entered...
							</div>
						}
					</div>
				}
				interactionKind={PopoverInteractionKind.CLICK}
				position={Position.TOP_LEFT}
				popoverClassName={'pt-minimal citation-popover'}
				transitionDuration={-1}
				inheritDarkTheme={false}
				tetherOptions={{
					constraints: [{ attachment: 'together', to: 'window' }]
				}}

			>
				<span className={'citation'}>[{props.count}]</span>
			</Popover>
		</div>
	);
};

CitationStatic.propTypes = propTypes;
export default CitationStatic;
