import {
  Selection,
  TextEditor,
  TextLine,
  Range,
  window
} from 'vscode'
import {InlineInput} from './inlineInput'
import {documentRippleScanner} from './documentRippleScanner'
import {AssociationManager} from './associationManager'

// TYPES
type Match = { start: number, end: number, excludedChars: string[] }
type MatchesArr = Match[]

export class FindJump {
  isActive = false
  inlineInput: InlineInput
  intervalHandler: any
  userInput: string = ''
  textEditor: TextEditor
  associationManager = new AssociationManager()
  activityIndicatorState = 0
  activatedWithSelection = false
  searchFunctionDebounceTracker: any
  dim: any;
  bright: any;
  allRanges: Array<Range> = [];

  activate = (textEditor: TextEditor) => {
    this.textEditor = textEditor

    if (this.isActive) {
      this.reset()
    }

    this.isActive = true

    this.inlineInput = new InlineInput({
      textEditor,
      onInput: this.onInput,
      onCancel: this.reset,
    })

    this.updateStatusBarWithActivityIndicator()
    this.startDim();
  }

  activateWithSelection = (textEditor: TextEditor) => {
    this.activatedWithSelection = true
    this.activate(textEditor)
  }

  onInput = (input: string, char: string) => {
    if (
      this.associationManager.associations.has(char) &&
      this.searchFunctionDebounceTracker === undefined
    ) {
      this.jump(char)
      return
    }

    this.userInput = input
    this.updateStatusBarWithActivityIndicator()

    clearTimeout(this.searchFunctionDebounceTracker)
    this.searchFunctionDebounceTracker = setTimeout(
      () => {
        this.performSearch()
        this.searchFunctionDebounceTracker = undefined
      },
      100,
    )
  }

  performSearch = () => {
    const {matches, availableJumpChars} = this.getMatchesAndAvailableJumpChars()

    if (matches.length > 0) {
      this.associationManager.dispose();

      // Dont gray out matches from previous iteration
       this.clearBright();
       this.allRanges = [];
    }

    for(let i = 0; i < matches.length; i++) {
      if (availableJumpChars[i] === undefined) {
        break
      }

      const match = matches[i]
      const availableJumpChar = availableJumpChars[i]
      const {index, value} = match
      const range = new Range(index, value.start, index, value.end)
      this.allRanges.push(new Range(index, value.start-1, index, Math.max(value.start+1,value.end)));
      this.associationManager.createAssociation(availableJumpChar, range, this.textEditor)
    }

    if (matches.length > 0) {
      this.bright = this.bright || window.createTextEditorDecorationType({
          textDecoration: `none; filter: none !important;`,
      });
      this.textEditor.setDecorations(this.bright, this.allRanges);
  }
  }

  jump = (jumpChar: string) => {
    this.clearDim();
    const range = this.associationManager.associations.get(jumpChar)

    if (!range) {
      return
    }

    const {line, character} = range.start

    this.textEditor.selection = new Selection(
      this.activatedWithSelection ? this.textEditor.selection.start.line : line,
      this.activatedWithSelection ? this.textEditor.selection.start.character : character,
      line,
      character,
    )

    this.reset()
  }

  getMatchesAndAvailableJumpChars = () => {
    const {document, selection} = this.textEditor
    const documentIterator = documentRippleScanner(document, selection.end.line)
    const availableJumpChars = [...this.associationManager.jumpChars]
    const matches: { value: Match, index: number }[] = []

    outer: for (const {line, index} of documentIterator) {
      const lineMatches = this.getLineMatches(line)

      for(const lineMatch of lineMatches) {
        if (matches.length >= availableJumpChars.length) {
          break outer
        }

        matches.push({value: lineMatch, index})

        for(const excludedChar of lineMatch.excludedChars) {
          for (let i = 0; i < 2; i++) {
            const method = i === 0 ? 'toLowerCase' : 'toUpperCase'
            const indexOfExcludedChar = availableJumpChars.indexOf(excludedChar[method]())

            if (indexOfExcludedChar !== -1) {
              availableJumpChars.splice(indexOfExcludedChar, 1)
            }
          }
        }
      }
    }

    return {matches, availableJumpChars}
  }

  getLineMatches = (line: TextLine): MatchesArr => {
    const indexes = []
    const {text} = line
    const haystack = text.toLowerCase()
    const needle = this.userInput.toLowerCase()

    let index = 0
    let iterationNumber = 0
    while (
      (index = haystack.indexOf(needle, iterationNumber === 0 ? 0 : index + needle.length)) !== -1
    ) {
      const start = index
      const end = index + needle.length
      const excludedChars = haystack.slice(end, end + 8).replace(/[^a-z]/gi, '').split('')
      indexes.push({start, end, excludedChars})
      iterationNumber++
    }

    return indexes
  }

  reset = () => {
    this.isActive = false
    this.activatedWithSelection = false
    this.userInput = ''
    this.clearActivityIndicator()
    this.inlineInput.destroy()
    this.associationManager.dispose()
    this.clearDim();
  }

  updateStatusBarWithActivityIndicator = () => {
    const callback = () => {
      if (this.activityIndicatorState === 1) {
        this.inlineInput.updateStatusBar(`Find-Jump: ${this.userInput} 🔴`)
        this.activityIndicatorState = 0
      } else {
        this.inlineInput.updateStatusBar(`Find-Jump: ${this.userInput} ⚪`)
        this.activityIndicatorState = 1
      }
    }

    this.inlineInput.updateStatusBar(
      `Find-Jump: ${this.userInput} ${this.activityIndicatorState === 0 ? '🔴' : '⚪'}`,
    )

    if (this.intervalHandler === undefined) {
      this.intervalHandler = setInterval(callback, 600)
    }
  }

  clearActivityIndicator = () => {
    clearInterval(this.intervalHandler)
    this.intervalHandler = undefined
  }

  clearDim = () => {
    if (!!this.dim) {
        this.textEditor.setDecorations(this.dim, []);
        this.dim.dispose();
        delete this.dim;
    }
    this.clearBright();
  }

  clearBright = () => {
    if (!!this.bright) {
        this.textEditor.setDecorations(this.bright, []);
        this.bright.dispose();
        delete this.bright;
    }
  }

  startDim = () => {
    this.dim = window.createTextEditorDecorationType({
        textDecoration: `none; filter: grayscale(1);`
    });
    this.textEditor.setDecorations(this.dim, [new Range(0, 0, this.textEditor.document.lineCount, Number.MAX_VALUE)])
  }

}
