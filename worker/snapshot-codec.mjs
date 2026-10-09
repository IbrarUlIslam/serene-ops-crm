// D1 rows have a 2MB ceiling. Store large snapshots as bounded gzip/base64 text;
// callers continue receiving the same JSON object and the same revision token.
export const SNAPSHOT_GZIP_PREFIX = 'SERENE_SNAPSHOT_GZIP_V1:';
export const SNAPSHOT_COMPRESSION_THRESHOLD = 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_STORED_SNAPSHOT_BYTES = 1_979_000; // Reserve room for row metadata.
const encoder = new TextEncoder();
const codecError = (message,code='SNAPSHOT_CORRUPTED') => Object.assign(new Error(message),{code});
const tooLarge = () => codecError('The workspace exceeds its safe storage limit. Contact Ibrar before adding more data.','SNAPSHOT_TOO_LARGE');

async function boundedBytes(stream,limit) {
  const reader=stream.getReader(),chunks=[];let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel().catch(()=>{});throw tooLarge();}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function base64(bytes) {
  const chunks=[];for(let at=0;at<bytes.length;at+=32768)chunks.push(String.fromCharCode(...bytes.subarray(at,at+32768)));
  return btoa(chunks.join(''));
}
function fromBase64(value) {
  const padding=value.indexOf('=');
  if(!value || value.length%4 || /[^A-Za-z0-9+/=]/.test(value) || padding>=0&&(padding<value.length-2||!/^={1,2}$/.test(value.slice(padding))))throw codecError('Stored snapshot encoding is invalid.');
  const binary=atob(value),bytes=new Uint8Array(binary.length);for(let at=0;at<binary.length;at++)bytes[at]=binary.charCodeAt(at);return bytes;
}

export async function encodeSnapshot(value) {
  const text=typeof value==='string'?value:JSON.stringify(value);
  if(typeof text!=='string')throw codecError('Snapshot value is invalid.');
  const bytes=encoder.encode(text);
  if(bytes.length>MAX_SNAPSHOT_BYTES)throw tooLarge();
  if(bytes.length<SNAPSHOT_COMPRESSION_THRESHOLD)return text;
  let compressed;
  try {compressed=await boundedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),Math.floor(MAX_STORED_SNAPSHOT_BYTES*3/4));}
  catch(error){if(error.code==='SNAPSHOT_TOO_LARGE'&&bytes.length<MAX_STORED_SNAPSHOT_BYTES)return text;throw error;}
  const stored=SNAPSHOT_GZIP_PREFIX+bytes.length+':'+base64(compressed);
  // Incompressible data that still fits may retain its legacy plain format.
  if(stored.length>=bytes.length&&bytes.length<MAX_STORED_SNAPSHOT_BYTES)return text;
  if(stored.length>=MAX_STORED_SNAPSHOT_BYTES)throw tooLarge();
  return stored;
}

export async function decodeSnapshotText(stored) {
  if(typeof stored!=='string')throw codecError('Stored snapshot is invalid.');
  if(!stored.startsWith(SNAPSHOT_GZIP_PREFIX)) {
    if(encoder.encode(stored).length>MAX_SNAPSHOT_BYTES)throw tooLarge();
    return stored;
  }
  if(stored.length>=MAX_STORED_SNAPSHOT_BYTES)throw tooLarge();
  const rest=stored.slice(SNAPSHOT_GZIP_PREFIX.length),separator=rest.indexOf(':');
  const lengthText=rest.slice(0,separator),expected=Number(lengthText);
  if(separator<1||!/^\d{1,8}$/.test(lengthText)||!Number.isSafeInteger(expected)||expected<1)throw codecError('Stored snapshot length is invalid.');
  if(expected>MAX_SNAPSHOT_BYTES)throw tooLarge();
  const bytes=fromBase64(rest.slice(separator+1));
  let output;
  try {output=await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),expected);}
  catch(error){if(error.code==='SNAPSHOT_TOO_LARGE')throw error;throw codecError('Stored compressed snapshot is corrupted.');}
  if(output.length!==expected)throw codecError('Stored snapshot length does not match.');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(output);}catch{throw codecError('Stored snapshot text is invalid.');}
}

export async function decodeSnapshot(stored) {
  const text=await decodeSnapshotText(stored);
  try{return JSON.parse(text);}catch{throw codecError('Stored snapshot JSON is invalid.');}
}
