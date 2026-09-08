import { LocalComputerUseToolProviderConfig } from "@/config/tool_config";
import { Tool } from "../tools";
import { ComputerUseToolProvider } from "./base_provider";

// local computer
export class LocalComputerUseToolProvider extends ComputerUseToolProvider {
    config: LocalComputerUseToolProviderConfig;

    constructor(config: LocalComputerUseToolProviderConfig) {
        super();
        this.config = config;
    }

    async createTools(): Promise<Tool[]> {
        return [];
    }
}
