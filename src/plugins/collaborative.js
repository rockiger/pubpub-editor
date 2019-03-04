import { AllSelection, EditorState, Plugin, Selection, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { collab, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { Step } from 'prosemirror-transform';
import { Node } from 'prosemirror-model';
import {
	compressSelectionJSON,
	compressStateJSON,
	compressStepJSON,
	uncompressSelectionJSON,
	uncompressStateJSON,
	uncompressStepJSON,
} from 'prosemirror-compress-pubpub';

const TIMESTAMP = { '.sv': 'timestamp' };
const SAVE_EVERY_N_STEPS = 100;

class CollaborativePlugin extends Plugin {
	constructor({
		firebaseRef,
		initialContent,
		initialDocKey,
		localClientData,
		localClientId,
		onClientChange,
		onStatusChange,
	}) {
		super({ key: new PluginKey('collaborative') });

		/* Bind plugin functions */
		this.loadDocument = this.loadDocument.bind(this);
		this.sendCollabChanges = this.sendCollabChanges.bind(this);
		this.apply = this.apply.bind(this);
		this.updateView = this.updateView.bind(this);
		this.disconnect = this.disconnect.bind(this);
		this.decorations = this.decorations.bind(this);
		this.addClientSelection = this.addClientSelection.bind(this);
		this.updateClientSelection = this.updateClientSelection.bind(this);
		this.deleteClientSelection = this.deleteClientSelection.bind(this);
		this.issueEmptyTransaction = this.issueEmptyTransaction.bind(this);
		this.handleRemoteChanges = this.handleRemoteChanges.bind(this);
		this.setResendTimeout = this.setResendTimeout.bind(this);
		// this.getJSONs = this.getJSONs.bind(this);

		/* Make passed props accessible */
		this.initialContent = initialContent;
		this.localClientData = localClientData;
		this.localClientId = localClientId;

		const emptyFunc = () => {};
		this.onClientChange = onClientChange || emptyFunc;
		this.onStatusChange = onStatusChange || emptyFunc;

		/* Init plugin variables */
		this.startedLoad = false;
		this.view = null;
		this.mostRecentRemoteKey = initialDocKey;
		this.selections = {};
		this.ongoingTransaction = false;
		this.resendSyncTimeout = undefined;

		/* Setup Prosemirror plugin values */
		this.spec = {
			view: this.updateView,
			state: {
				init: () => {
					return { isLoaded: false };
				},
				apply: this.apply,
			},
		};
		this.props = {
			decorations: this.decorations,
		};

		/* Check for firebaseConfig */
		if (!firebaseRef) {
			throw new Error('Did not include a firebase ref');
		}

		this.firebaseRef = firebaseRef;

		/* Set user status and watch for status changes */
		/* TODO - do we pass in the database instead? Or handle this disconnect from above? */
		// this.database.ref('.info/connected').on('value', (snapshot) => {
		// 	if (snapshot.val() === true) {
		// 		this.onStatusChange('connected');
		// 	} else {
		// 		this.onStatusChange('disconnected');
		// 	}
		// });
	}

	disconnect() {
		this.firebaseApp.delete();
	}

	loadDocument() {
		if (this.startedLoad) {
			return null;
		}
		this.startedLoad = true;

		return this.firebaseRef
			.child('changes')
			.orderByKey()
			.startAt(String(this.mostRecentRemoteKey + 1))
			.once('value')
			.then((changesSnapshot) => {
				const changesSnapshotVal = changesSnapshot.val() || {};
				const steps = [];
				const stepClientIds = [];
				const keys = Object.keys(changesSnapshotVal);
				this.mostRecentRemoteKey = keys.length
					? Math.max(...keys)
					: this.mostRecentRemoteKey;

				/* Uncompress steps and add stepClientIds */
				Object.keys(changesSnapshotVal).forEach((key) => {
					const compressedStepsJSON = changesSnapshotVal[key].s;
					const uncompressedSteps = compressedStepsJSON.map((compressedStepJSON) => {
						return Step.fromJSON(
							this.view.state.schema,
							uncompressStepJSON(compressedStepJSON),
						);
					});
					steps.push(...uncompressedSteps);
					stepClientIds.push(
						...new Array(compressedStepsJSON.length).fill(changesSnapshotVal[key].c),
					);
				});

				/* Update the prosemirror view with new doc */
				const newDoc = Node.fromJSON(this.view.state.schema, this.initialContent);
				this.view.updateState(
					EditorState.create({
						doc: newDoc,
						plugins: this.view.state.plugins,
					}),
				);

				const trans = receiveTransaction(this.view.state, steps, stepClientIds);
				this.view.dispatch(trans);

				/* Listen to Selections Change */
				console.log('about to set listeners');
				const selectionsRef = this.firebaseRef.child('selections');
				selectionsRef
					.child(this.localClientId)
					.onDisconnect()
					.remove();
				selectionsRef.on('child_added', this.addClientSelection);
				selectionsRef.on('child_changed', this.updateClientSelection);
				selectionsRef.on('child_removed', this.deleteClientSelection);

				const finishedLoadingTrans = this.view.state.tr;
				finishedLoadingTrans.setMeta('finishedLoading', true);
				this.view.dispatch(finishedLoadingTrans);

				/* Listen to Changes */
				return this.firebaseRef
					.child('changes')
					.orderByKey()
					.startAt(String(this.mostRecentRemoteKey + 1))
					.on('child_added', this.handleRemoteChanges);
			})
			.catch((err) => {
				console.error('In loadDocument Error with ', err, err.message);
			});
	}

	handleRemoteChanges(snapshot) {
		this.mostRecentRemoteKey = Number(snapshot.key);
		const snapshotVal = snapshot.val();
		const compressedStepsJSON = snapshotVal.s;
		const clientId = snapshotVal.c;
		const meta = snapshotVal.m;

		const newSteps = compressedStepsJSON.map((compressedStepJSON) => {
			return Step.fromJSON(this.view.state.schema, uncompressStepJSON(compressedStepJSON));
		});
		const newStepsClientIds = new Array(newSteps.length).fill(clientId);
		const trans = receiveTransaction(this.view.state, newSteps, newStepsClientIds);

		if (meta) {
			Object.keys(meta).forEach((metaKey) => {
				trans.setMeta(metaKey, meta[metaKey]);
			});
		}

		/* We do getSelection().empty() because of a chrome bug: */
		/* https://discuss.prosemirror.net/t/in-collab-setup-with-selections-cursor-jumps-to-a-different-position-without-selection-being-changed/1011 */
		/* https://github.com/ProseMirror/prosemirror/issues/710 */
		/* https://bugs.chromium.org/p/chromium/issues/detail?id=775939 */
		/* To reproduce, put one cursor in the middle of the last line of the paragraph, */
		/* and then with another cursor begin typing at the end of the paragraph. The typing */
		/* cursor will jump to the location of the middle cursor. */
		const selection = document.getSelection();
		const anchorNode = selection.anchorNode || { className: '' };
		const anchorClasses = anchorNode.className || '';
		if (
			selection &&
			selection.isCollapsed &&
			anchorClasses.indexOf('options-wrapper') === -1 &&
			this.view.hasFocus()
		) {
			document.getSelection().empty();
		}

		return this.view.dispatch(trans);
	}

	sendCollabChanges(transaction, newState) {
		console.log('in send collab');
		// TODO: Rather than exclude - we should probably explicitly list the types of transactions we accept.
		// Exluding only will break when others add custom plugin transactions.
		const meta = transaction.meta;
		if (
			meta.buildingJSON ||
			meta.finishedLoading ||
			meta.collab$ ||
			meta.rebase ||
			meta.footnote ||
			meta.highlightsToRemove ||
			meta.newHighlightsData ||
			meta.appendedTransaction
		) {
			return null;
		}

		/* Don't send certain keys with to firebase */
		Object.keys(meta).forEach((key) => {
			if (key.indexOf('$') > -1 || key === 'addToHistory' || key === 'pointer') {
				delete meta[key];
			}
		});

		const sendable = sendableSteps(newState);
		if (!sendable) {
			return null;
		}

		if (this.ongoingTransaction) {
			/* We only allow one outgoing transaction at a time. Sometimes the
			local view is updated before an ongoing transaction is finished. If this
			is the case, we abort the newly triggered outgoing transaction. If we do
			that, we need to ensure we eventually send the most recent state for
			syncing. This timeout ensures that. */
			this.setResendTimeout();
			return null;
		}

		this.ongoingTransaction = true;
		const steps = sendable.steps;
		const clientId = sendable.clientID;

		return this.firebaseRef
			.child('changes')
			.child(this.mostRecentRemoteKey + 1)
			.transaction(
				(existingRemoteSteps) => {
					this.onStatusChange('saving');
					if (existingRemoteSteps) {
						return undefined;
					}
					return {
						s: steps.map((step) => {
							return compressStepJSON(step.toJSON());
						}),
						c: clientId,
						m: meta,
						t: TIMESTAMP,
					};
				},
				(error, committed, snapshot) => {
					this.ongoingTransaction = false;
					if (error) {
						console.error('Error in sendCollab transaction', error, steps, clientId);
						return null;
					}

					if (committed) {
						this.onStatusChange('saved');

						/* If multiple of SAVE_EVERY_N_STEPS, update checkpoint */
						if (snapshot.key % SAVE_EVERY_N_STEPS === 0) {
							this.firebaseRef.child('checkpoint').set({
								d: compressStateJSON(newState.toJSON()).d,
								k: snapshot.key,
								t: TIMESTAMP,
							});
						}
					} else {
						/* If the transaction did not commit changes, we need
				to trigger sendCollabChanges to fire again. */
						this.setResendTimeout();
					}

					return undefined;
				},
				false,
			)
			.catch(() => {
				this.ongoingTransaction = false;
				this.setResendTimeout();
			});
	}

	setResendTimeout() {
		clearTimeout(this.resendSyncTimeout);
		this.resendSyncTimeout = setTimeout(() => {
			this.sendCollabChanges({ meta: {} }, this.view.state);
		}, 2000);
		return null;
	}

	apply(transaction, state, prevEditorState, editorState) {
		/* Remove Stale Selections */
		Object.keys(this.selections).forEach((clientId) => {
			const originalClientData = this.selections[clientId]
				? this.selections[clientId].data
				: {};
			const expirationTime = 1000 * 60 * 5; /* 5 minutes */
			const lastActiveExpired =
				originalClientData.lastActive + expirationTime < new Date().getTime();
			if (!originalClientData.lastActive || lastActiveExpired) {
				this.firebaseRef
					.child('selections')
					.child(clientId)
					.remove();
			}
		});

		/* Map Selection */
		if (transaction.docChanged && !transaction.meta.buildingJSON) {
			Object.keys(this.selections).forEach((clientId) => {
				if (this.selections[clientId] && this.selections[clientId] !== this.localClientId) {
					const originalClientData = this.selections[clientId]
						? this.selections[clientId].data
						: {};
					this.selections[clientId] = this.selections[clientId].map(
						editorState.doc,
						transaction.mapping,
					);
					this.selections[clientId].data = originalClientData;
				}
			});
		}

		/* Set Selection */
		const prevSelection = this.selections[this.localClientId] || {};
		const selection = editorState.selection || {};
		const needsToInit = !prevSelection.anchor;
		const isPointer = transaction.meta.pointer;
		const isNotSelectAll = selection instanceof AllSelection === false;
		const isCursorChange =
			!transaction.docChanged &&
			(selection.anchor !== prevSelection.anchor || selection.head !== prevSelection.head);
		if (isNotSelectAll && (needsToInit || isPointer || isCursorChange)) {
			const prevLocalSelectionData = this.selections[this.localClientId] || {};
			const anchorEqual = prevLocalSelectionData.anchor === selection.anchor;
			const headEqual = prevLocalSelectionData.head === selection.head;
			if (!prevLocalSelectionData.anchor || !anchorEqual || !headEqual) {
				const compressed = compressSelectionJSON(selection.toJSON());
				compressed.data = this.localClientData;
				if (needsToInit) {
					compressed.a = 1;
					compressed.h = 1;
				}

				/* compressed.data.lastActive has to be rounded to the nearest minute (or some larger value)
				If it is updated every millisecond, firebase will see it as constant changes and you'll get a 
				loop of updates triggering millisecond updates. The lastActive is updated anytime a client 
				makes or receives changes. A client will be active even if they have a tab open and are 'watching'. */
				const smoothingTimeFactor = 1000 * 60;
				compressed.data.lastActive =
					Math.round(new Date().getTime() / smoothingTimeFactor) * smoothingTimeFactor;

				this.selections[this.localClientId] = selection;
				this.selections[this.localClientId].data = this.localClientData;
				this.firebaseRef
					.child('selections')
					.child(this.localClientId)
					.set(compressed);
			}
		}
		/* Send Collab Changes */
		this.sendCollabChanges(transaction, editorState);

		if (transaction.meta.finishedLoading) {
			return { isLoaded: true };
		}
		return state;
	}

	issueEmptyTransaction() {
		this.view.dispatch(this.view.state.tr);
	}

	updateClientSelection(snapshot) {
		console.log('update client selection');
		/* Called on firebase updates to selection */
		const clientID = snapshot.key;
		if (clientID !== this.localClientId) {
			const snapshotVal = snapshot.val();
			/* Invalid selections can happen if a selection is synced before the corresponding changes from that 
			remote editor. We simply remove the selection in that case, and wait for the proper position to sync. */
			const invalidSelection =
				Math.max(snapshotVal.a, snapshotVal.h) > this.view.state.doc.content.size - 1;
			if (snapshotVal && !invalidSelection) {
				this.selections[clientID] = Selection.fromJSON(
					this.view.state.doc,
					uncompressSelectionJSON(snapshotVal),
				);
				this.selections[clientID].data = snapshotVal.data;
			} else {
				delete this.selections[clientID];
			}
			this.issueEmptyTransaction();
		}
	}

	addClientSelection(snapshot) {
		this.updateClientSelection(snapshot);
		if (this.onClientChange) {
			this.onClientChange(
				Object.keys(this.selections)
					.filter((key) => {
						return this.selections[key];
					})
					.map((key) => {
						return this.selections[key].data;
					}),
			);
		}
	}

	deleteClientSelection(snapshot) {
		const clientID = snapshot.key;
		delete this.selections[clientID];
		if (this.onClientChange) {
			this.onClientChange(
				Object.keys(this.selections)
					.filter((key) => {
						return this.selections[key];
					})
					.map((key) => {
						return this.selections[key].data;
					}),
			);
		}
		this.issueEmptyTransaction();
	}

	updateView(view) {
		this.view = view;
		this.loadDocument();
		return {
			update: (newView) => {
				this.view = newView;
			},
			destroy: () => {
				this.view = null;
			},
		};
	}

	decorations(state) {
		const selectionKeys = Object.keys(this.selections);
		const decorations = [];
		selectionKeys.forEach((clientId) => {
			if (clientId === this.localClientId) {
				return null;
			}

			const selection = this.selections[clientId];
			if (!selection) {
				return null;
			}

			const data = selection.data || {};
			if (!data.canEdit) {
				return null;
			}

			/* Classnames must begin with letter, so append one single uuid's may not. */
			const formattedDataId = `c-${data.id}`;
			const elem = document.createElement('span');
			elem.className = `collab-cursor ${formattedDataId}`;

			/* Add Vertical Bar */
			const innerChildBar = document.createElement('span');
			innerChildBar.className = 'inner-bar';
			elem.appendChild(innerChildBar);

			const style = document.createElement('style');
			elem.appendChild(style);
			let innerStyle = '';

			/* Add small circle at top of bar */
			const innerChildCircleSmall = document.createElement('span');
			innerChildCircleSmall.className = `inner-circle-small ${formattedDataId}`;
			innerChildBar.appendChild(innerChildCircleSmall);

			/* Add wrapper for hover items at top of bar */
			const hoverItemsWrapper = document.createElement('span');
			hoverItemsWrapper.className = 'hover-wrapper';
			innerChildBar.appendChild(hoverItemsWrapper);

			/* Add Large Circle for hover */
			const innerChildCircleBig = document.createElement('span');
			innerChildCircleBig.className = 'inner-circle-big';
			hoverItemsWrapper.appendChild(innerChildCircleBig);

			/* If Initials exist - add to hover items wrapper */
			if (data.initials) {
				const innerCircleInitials = document.createElement('span');
				innerCircleInitials.className = `initials ${formattedDataId}`;
				innerStyle += `.initials.${formattedDataId}::after { content: "${
					data.initials
				}"; } `;
				hoverItemsWrapper.appendChild(innerCircleInitials);
			}
			/* If Image exists - add to hover items wrapper */
			if (data.image) {
				const innerCircleImage = document.createElement('span');
				innerCircleImage.className = `image ${formattedDataId}`;
				innerStyle += `.image.${formattedDataId}::after { background-image: url('${
					data.image
				}'); } `;
				hoverItemsWrapper.appendChild(innerCircleImage);
			}

			/* If name exists - add to hover items wrapper */
			if (data.name) {
				const innerCircleName = document.createElement('span');
				innerCircleName.className = `name ${formattedDataId}`;
				innerStyle += `.name.${formattedDataId}::after { content: "${data.name}"; } `;
				if (data.cursorColor) {
					innerCircleName.style.backgroundColor = data.cursorColor;
				}
				hoverItemsWrapper.appendChild(innerCircleName);
			}

			/* If cursor color provided - override defaults */
			if (data.cursorColor) {
				innerChildBar.style.backgroundColor = data.cursorColor;
				innerChildCircleSmall.style.backgroundColor = data.cursorColor;
				innerChildCircleBig.style.backgroundColor = data.cursorColor;
				innerStyle += `.name.${formattedDataId}::after { background-color: ${
					data.cursorColor
				} !important; } `;
			}
			style.innerHTML = innerStyle;

			const selectionFrom = selection.from;
			const selectionTo = selection.to;
			const selectionHead = selection.head;
			decorations.push(Decoration.widget(selectionHead, elem));

			if (selectionFrom !== selectionTo) {
				decorations.push(
					Decoration.inline(selectionFrom, selectionTo, {
						class: `collab-selection ${formattedDataId}`,
						style: `background-color: ${data.backgroundColor ||
							'rgba(0, 25, 150, 0.2)'};`,
					}),
				);
			}
			return null;
		});
		return DecorationSet.create(
			state.doc,
			decorations.filter((dec) => {
				return !!dec;
			}),
		);
	}
}

export default (schema, props) => {
	const collabOptions = props.collaborativeOptions;
	console.log(props.collaborativeOptions);
	if (!collabOptions.firebaseRef) {
		return [];
	}

	const possible = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let clientHash = '';
	for (let index = 0; index < 6; index += 1) {
		clientHash += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	const localClientId = `clientId-${collabOptions.clientData.id}-${clientHash}`;

	return [
		collab({
			clientID: localClientId,
		}),
		new CollaborativePlugin({
			firebaseRef: collabOptions.firebaseRef,
			initialContent: props.initialContent,
			initialDocKey: collabOptions.initialDocKey,
			localClientData: collabOptions.clientData,
			localClientId: localClientId,
			onClientChange: collabOptions.onClientChange,
			onStatusChange: collabOptions.onStatusChange,
		}),
	];
};
