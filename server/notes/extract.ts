import mammoth from 'mammoth';
import { unzipSync } from 'fflate';
import { decodeBytes } from '../../shared/importParse';
import { sniffImage } from '../apkg';
import { LIMITS, NotesError, type InputPart } from './types';

export interface Upload {
  name: string;
  buffer: Buffer;
}

const startsWith = (b: Buffer, text: string) => b.subarray(0, text.length).toString('latin1') === text;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Works out what each uploaded file really is (by its contents, never its name) and turns it into something the AI
 * can read: PDFs and pictures go through as they are; Word files and text become text.
 */
export async function readNotes(uploads: Upload[], pastedText: string): Promise<InputPart[]> {
  const pasted = pastedText.trim();
  if (uploads.length === 0 && !pasted) throw new NotesError('Add some notes first: upload a file or paste your notes in.');
  if (uploads.length > LIMITS.maxFiles) throw new NotesError(`Please use ${LIMITS.maxFiles} files or fewer at a time.`);

  const parts: InputPart[] = [];
  let binaryBytes = 0;
  let textChars = pasted.length;

  for (const { name, buffer } of uploads) {
    if (buffer.length === 0) throw new NotesError(`“${name}” is empty.`);

    if (startsWith(buffer, '%PDF-')) {
      binaryBytes += buffer.length;
      parts.push({ kind: 'pdf', name, data: buffer });
      continue;
    }

    const image = sniffImage(buffer);
    if (image) {
      if (buffer.length > LIMITS.maxImageBytes) {
        throw new NotesError(`“${name}” is ${mb(buffer.length)}, and pictures can be at most ${mb(LIMITS.maxImageBytes)}. Try a smaller photo or a screenshot.`);
      }
      binaryBytes += buffer.length;
      parts.push({ kind: 'image', name, mime: image.mime as 'image/png', data: buffer });
      continue;
    }
    if (buffer.subarray(4, 12).toString('latin1').startsWith('ftyp') && /heic|heix|mif1|heif/.test(buffer.subarray(8, 16).toString('latin1'))) {
      throw new NotesError(`“${name}” is an iPhone HEIC photo, which can't be read. Take a screenshot instead, or share it as a JPEG.`);
    }

    if (startsWith(buffer, 'PK')) {
      parts.push({ kind: 'text', name, text: await readWord(name, buffer) });
      textChars += (parts.at(-1) as { text: string }).text.length;
      continue;
    }
    if (startsWith(buffer, '{\\rtf')) throw new NotesError(`“${name}” is an RTF file, which isn't supported. Save it as a PDF or a Word (.docx) file first.`);
    if (buffer.subarray(0, 4000).includes(0) && !(buffer[0] === 0xff && buffer[1] === 0xfe) && !(buffer[0] === 0xfe && buffer[1] === 0xff)) {
      throw new NotesError(`“${name}” isn't a file type that can be read. Use a PDF, Word (.docx), text, Markdown or a picture.`);
    }

    const text = decodeBytes(new Uint8Array(buffer)).text.trim();
    if (!text) throw new NotesError(`“${name}” has no text in it.`);
    textChars += text.length;
    parts.push({ kind: 'text', name, text });
  }

  if (binaryBytes > LIMITS.maxBinaryBytes) {
    throw new NotesError(`The PDFs and pictures add up to ${mb(binaryBytes)}, and the limit is ${mb(LIMITS.maxBinaryBytes)} in total. Try fewer or smaller files.`);
  }
  if (textChars > LIMITS.maxTextChars) {
    throw new NotesError(`That is a lot of text (${Math.round(textChars / 1000)}k characters). Please split it up: the limit is ${Math.round(LIMITS.maxTextChars / 1000)}k at a time.`);
  }
  if (pasted) parts.push({ kind: 'text', name: 'Pasted notes', text: pasted });
  return parts;
}

async function readWord(name: string, buffer: Buffer): Promise<string> {
  let isWord = false;
  let total = 0;
  try {
    unzipSync(buffer, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 100 * 1024 * 1024) throw new NotesError(`“${name}” is too large once opened.`);
        if (f.name === 'word/document.xml') isWord = true;
        return false; // we only need to know what is inside
      },
    });
  } catch (err) {
    if (err instanceof NotesError) throw err;
    throw new NotesError(`“${name}” couldn't be opened. If it's a Word file, try saving it again as .docx.`);
  }
  if (!isWord) {
    throw new NotesError(`“${name}” is a zip-based file that isn't a Word document. PowerPoint and Excel files aren't supported yet: save them as a PDF first.`);
  }
  let text: string;
  try {
    text = (await mammoth.extractRawText({ buffer })).value.trim();
  } catch {
    throw new NotesError(`“${name}” couldn't be read. Try saving it again as .docx, or as a PDF.`);
  }
  if (!text) throw new NotesError(`“${name}” has no text in it (if it only contains pictures, save it as a PDF).`);
  return text;
}
