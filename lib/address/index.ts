import sha256 from 'hash.js/lib/hash/sha/256';
import { Buffer } from 'buffer';

import { base58ToBinary, binaryToBase58 } from 'lib/crypto/base58';
import { assert } from 'lib/assert';
import { INVALID_CHECKSUM } from './errors';


function encode(data: Uint8Array | Buffer, prefix = '00') {
  const bufPrefix = Buffer.from(prefix, 'hex');
  let hash = Buffer.concat([bufPrefix, data]);

  hash = sha256().update(hash).digest();
  hash = Buffer.from(sha256().update(hash).digest());
  hash = Buffer.concat([bufPrefix, data,  hash.slice(0, 4)]);

  return binaryToBase58(hash);
}

function decode(content: string) {
  const bytes = base58ToBinary(content);
  const buffer = Buffer.from(bytes);

  const prefix = buffer.slice(0, 1);
  const data = buffer.slice(1, -4);
  let hash = Buffer.concat([prefix, data]);

  hash = sha256().update(hash).digest();
  hash = sha256().update(hash).digest();

  buffer.slice(-4).forEach((check, index) => {
    assert(check === hash[index], INVALID_CHECKSUM);
  });

  return {
    prefix,
    data
  };
}


export function base58Encode(data: Buffer | Uint8Array): string {
  const bufData = Buffer.from(data);

  return encode(bufData.slice(1), bufData[0].toString(16).padStart(2, "0"));
}

export function base58Decode(data: string): Buffer {
  const decoded = decode(data);
  return Buffer.concat([decoded.prefix, decoded.data]);
}
