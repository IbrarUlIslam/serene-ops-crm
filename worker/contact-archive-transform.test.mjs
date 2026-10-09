import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {replaceBundledTemplate}=createRequire(import.meta.url)('./integrate-contact-archive.cjs');
test('archive CLI template writer preserves literal replacement sequences and escaped script endings',()=>{
 const outer='<html><script type="__bundler/template">"old"</script></html>',next='<script>const replacements = "$& $1 $` $\'";</script><div>Archive</div>';
 const written=replaceBundledTemplate(outer,next),raw=written.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(raw),next);assert.equal(written.startsWith('<html>'),true);assert.equal(written.endsWith('</html>'),true);assert.equal(replaceBundledTemplate(written,next),written);
});
