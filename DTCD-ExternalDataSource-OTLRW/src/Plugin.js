import { pluginMeta } from './../package.json';

import {
  InteractionSystemAdapter,
  LogSystemAdapter,
  InProgressError,
  BaseExternalDataSource,
} from 'SDK';
import { OTPConnectorService } from '../../ot_js_connector';

const connectorConfig = {
  modeHTTP: 'http',
  username: 'admin',
  password: '12345678',
  maxJobExecTime: 300,
  checkjobDelayTime: 1,
  httpRequestTimeout: 70,
  loginBeforeJobRun: false,
};

export class DataSourcePlugin extends BaseExternalDataSource {
  #interactionSystem;
  #logSystem;
  #otpService;

  #job;
  #jobWrite;
  #jobParams = {};
  #jobWriteParams = {};

  static getExtensionInfo() {
    return { type: 'OTLRW' };
  }

  static getRegistrationMeta() {
    return pluginMeta;
  }

  constructor({ queryString: original_otl, queryWriteString: original_otlWrite, ...rest }) {
    super();
    this.#logSystem = new LogSystemAdapter('0.5.0', 'no-guid', pluginMeta.name);
    this.#interactionSystem = new InteractionSystemAdapter('0.4.0');
    this.#logSystem.debug(
      `Initing ExternalDatasource-OTLRW instance with parameters: ${JSON.stringify({
        original_otl,
        original_otlWrite,
        ...rest,
      })}`
    );
    this.#jobParams = { original_otl, ...rest };
    this.#jobWriteParams = { original_otl: original_otlWrite, ...rest };

    const { baseURL: url } = this.#interactionSystem.instance;
    this.#otpService = new OTPConnectorService(
      { url, ...connectorConfig },
      this.#interactionSystem.instance
    );
  }

  async init() {
    try {
      this.#logSystem.debug(
        `Creating OTL job instance with parameters: ${JSON.stringify(this.#jobParams)}`
      );
      this.#job = await this.#otpService.jobManager.createJob(this.#jobParams, { blocking: true });
      return true;
    } catch (error) {
      this.#logSystem.error(`Error occured while creating OTL job: ${JSON.stringify(error)}`);
      console.error(error);
      return false;
    }
  }

  async initWrite() {
    try {
      this.#logSystem.debug(
        `Creating OTL write job instance with parameters: ${JSON.stringify(this.#jobWriteParams)}`
      );
      this.#jobWrite = await this.#otpService.jobManager.createJob(this.#jobWriteParams, { blocking: true });
      return true;
    } catch (error) {
      this.#logSystem.error(`Error occured while creating OTL write job: ${JSON.stringify(error)}`);
      console.error(error);
      return false;
    }
  }

  async getSchema() {
    return await this.#job.dataset().parseSchema();
  }

  async getData() {
    return await this.#job.dataset().data();
  }

  async rerun() {
    if (!this.#job) return;
    await this.#job.run();
  }

  editParams({ queryString: original_otl, queryWriteString: original_otlWrite, dataset, ...rest }) {
    if (original_otl) {
      this.#logSystem.debug(
        `Editing parameters of OTL job. Merging new parameters: ${JSON.stringify({
          original_otl,
          ...rest,
        })} to existing: ${JSON.stringify(this.#jobParams)}`
      );

      this.#jobParams = Object.assign(this.#jobParams, { original_otl, ...rest });
    } else {
      this.#logSystem.debug(
        `Editing parameters of OTL job. Merging new parameters: ${JSON.stringify(
          rest
        )} to existing: ${JSON.stringify(this.#jobParams)}`
      );

      this.#jobParams = Object.assign(this.#jobParams, rest);
    }

    if (original_otlWrite !== undefined) {
      this.#logSystem.debug(
        `Editing parameters of OTL write job. Merging new parameters: ${JSON.stringify({
          original_otlWrite,
          ...rest,
        })} to existing: ${JSON.stringify(this.#jobWriteParams)}`
      );

      let processedOtl = original_otlWrite
      if (dataset) {
        processedOtl = this.datasetToOtl(dataset) + original_otlWrite
      }

      this.#jobWriteParams = Object.assign(this.#jobWriteParams, { original_otl: processedOtl, ...rest });


    } else {
      this.#logSystem.debug(
        `Editing parameters of OTL write job. Merging new parameters: ${JSON.stringify(
          rest
        )} to existing: ${JSON.stringify(this.#jobWriteParams)}`
      );

      this.#jobWriteParams = Object.assign(this.#jobWriteParams, rest);
    }
  }

  datasetToOtl(dataset) {
    const defaultString = '| makeresults count=1 '
    return dataset.reduce((acc, item, itemIndex) => {
      if (acc !== defaultString) {
        acc += '| append [|makeresults count=1 '
      }
      const itemKeys = Object.keys(item)
      itemKeys.forEach((prop, propIndex) => {
        acc += `| eval ${prop}=`
        if (item[prop] !== undefined) {
          acc += typeof item[prop] === 'string' ? `"${item[prop]}"` : `${item[prop]}`
        } else {
          acc += `null`
        }
      })
      if (itemIndex > 0) {
        acc += ']'
      }

      return acc
    }, defaultString)
  }
}
