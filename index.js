#!/usr/bin/env node
const fs = require("fs");
const mkdirp = require("mkdirp");
const yargs = require("yargs");
const {
  validateSchema,
  verifySignature,
  obfuscateFields,
  schemas
} = require("@govtechsg/open-certificate");
const batchVerify = require("./src/batchVerify");
const { batchIssue } = require("./src/batchIssue");
const { logger, addConsole } = require("./lib/logger");
const { version } = require("./package.json");

// Pass argv with $1 and $2 sliced
const parseArguments = argv =>
  yargs
    .version(version)
    .usage("Certificate issuing, verification and revocation tool.")
    .strict()
    .epilogue(
      "The common subcommands you might be interested in are:\n" +
        "- batch\n" +
        "- verify\n" +
        "- verify-all\n" +
        "- filter"
    )
    .options({
      "log-level": {
        choices: ["error", "warn", "info", "verbose", "debug", "silly"],
        default: "info",
        description: "Set the log level",
        global: true
      },
      schema: {
        choices: Object.keys(schemas),
        description: "Set the schema to use",
        default: Object.keys(schemas)[Object.keys(schemas).length - 1],
        global: true,
        type: "string"
      }
    })
    .command({
      command: "filter <source> <destination> [fields..]",
      description: "Obfuscate fields in the certificate",
      builder: sub =>
        sub
          .positional("source", {
            description: "Source signed certificate filename",
            normalize: true
          })
          .positional("destination", {
            description: "Destination to write obfuscated certificate file to",
            normalize: true
          })
    })
    .command({
      command: "verify [options] <file>",
      description: "Verify the certificate",
      builder: sub =>
        sub.positional("file", {
          description: "Certificate file to verify",
          normalize: true
        })
    })
    .command({
      command: "verify-all [options] <dir>",
      description: "Verify all certiifcate in a directory",
      builder: sub =>
        sub.positional("dir", {
          description: "Directory with all certificates to verify",
          normalize: true
        })
    })
    .command({
      command: "batch [options] <raw-dir> <batched-dir>",
      description:
        "Combine a directory of certificates into a certificate batch",
      builder: sub =>
        sub
          .positional("raw-dir", {
            description:
              "Directory containing the raw unissued and unsigned certificates",
            normalize: true
          })
          .positional("batched-dir", {
            description: "Directory to output the batched certificates to.",
            normalize: true
          })
    })
    .parse(argv);

const batch = async (raw, batched, schemaVersion) => {
  mkdirp.sync(batched);
  return batchIssue(raw, batched, schemaVersion)
    .then(merkleRoot => {
      logger.debug(`Batch Certificate Root: 0x${merkleRoot}`);
      return `0x${merkleRoot}`;
    })
    .catch(err => {
      logger.error(err);
    });
};

const verifyAll = async (dir, schemaVersion) => {
  const verified = await batchVerify(dir, schemaVersion);
  if (verified) {
    logger.debug(`All certificates in ${dir} is verified`);
    return true;
  }
  logger.error("At least one certificate failed verification");
  return false;
};

const verify = (file, schemaVersion) => {
  const certificateJson = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    verifySignature(certificateJson) &&
    validateSchema(certificateJson, schemaVersion)
  ) {
    logger.debug("Certificate's signature is valid!");
    logger.warn(
      "Warning: Please verify this certificate on the blockchain with the issuer's certificate store."
    );
  } else {
    logger.error("Certificate's signature is invalid");
  }

  return true;
};

const obfuscate = (input, output, fields) => {
  const certificateJson = JSON.parse(fs.readFileSync(input, "utf8"));
  const obfuscatedCertificate = obfuscateFields(certificateJson, fields);
  const isValid =
    verifySignature(obfuscatedCertificate) &&
    validateSchema(obfuscatedCertificate);

  if (!isValid) {
    logger.error(
      "Privacy filtering caused document to fail schema or signature validation"
    );
  } else {
    fs.writeFileSync(output, JSON.stringify(obfuscatedCertificate, null, 2));
    logger.debug(`Obfuscated certificate saved to: ${output}`);
  }
};

const main = async argv => {
  const args = parseArguments(argv);
  addConsole(args.logLevel);
  logger.debug(`Parsed args: ${JSON.stringify(args)}`);

  const selectedSchema = schemas[args.schema];

  if (args._.length !== 1) {
    yargs.showHelp("log");
    return false;
  }
  switch (args._[0]) {
    case "batch":
      return batch(args.rawDir, args.batchedDir, selectedSchema);
    case "verify":
      return verify(args.file, selectedSchema);
    case "verify-all":
      return verifyAll(args.dir, selectedSchema);
    case "filter":
      return obfuscate(args.source, args.destination, args.fields);
    default:
      throw new Error(`Unknown command ${args._[0]}. Possible bug.`);
  }
};

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv.slice(2))
    .then(res => {
      // eslint-disable-next-line no-console
      if (res) console.log(res);
      process.exit(0);
    })
    .catch(err => {
      logger.error(`Error executing: ${err}`);
      if (typeof err.stack !== "undefined") {
        logger.debug(err.stack);
      }
      logger.debug(JSON.stringify(err));
      process.exit(1);
    });
}
