#include "StressTestRunner.h"

#include "splat/SplatGenerator.h"
#include "splat/SplatRenderer.h"
#include "ui/Viewport.h"

#include <QElapsedTimer>

#include <cstdint>

namespace {
	//Runs fn and returns how long it took in milliseconds
	template <typename Fn>
	double MeasureMs(Fn&& fn) {
		QElapsedTimer timer;
		timer.start();
		fn();
		return static_cast<double>(timer.nsecsElapsed()) / 1.0e6;
	}
}

std::vector<StressResult> StressTestRunner::TestLoad(size_t count) {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer || renderer->ModelCount() >= static_cast<size_t>(SplatRenderer::kMaxModels)) {
		return {};
	}

	std::vector<SplatVertex> splats;
	const double generateMs = MeasureMs([&] { splats = splat_generate::GenerateSphereSplats(count); });
	const double setMs = MeasureMs([&] { renderer->SetSplats(splats, "StressTestSphere"); });
	const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

	return {
		{ "Load: generate splats", count, generateMs },
		{ "Load: SetSplats (CPU copy)", count, setMs },
		{ "Load: first frame (upload + draw)", count, frameMs },
		{ "Load: total", count, generateMs + setMs + frameMs },
	};
}

std::vector<StressResult> StressTestRunner::TestSelect() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!renderer->GetModel(modelIndex) || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking(); //Block renderer

	//Struct of test cases
	struct Case { const char* label; size_t stride; };
	const Case cases[] = { { "all", 1 }, { "half", 2 }, { "tenth", 10 } };

	std::vector<StressResult> results;

	//Loop for each test case
	for (const Case& c : cases) {
		std::vector<uint32_t> indices;
		const double setMs = MeasureMs([&]
			{
				//Reserve enough space for all selected splats
				indices.reserve(total / c.stride + 1);
				for (size_t i = 0; i < total; i += c.stride)
				{
					//Push back to store selected splats index
					//Ascending order, SetSelection expects it that way
					indices.push_back(static_cast<uint32_t>(i)); 
				}
				//Actually select the splats
				renderer->SetSelection(modelIndex, std::move(indices));
			});
		const size_t selected = renderer->Selection().size();
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Select %1").arg(c.label);
		results.push_back({ label + ": build + SetSelection (CPU)", selected, setMs });
		results.push_back({ label + ": first frame (re-mark + upload)", selected, frameMs });

		//Back to nothing selected, so the next case starts the same way
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}

	//Deselecting a full selection, the selection itself is set up outside the timing
	std::vector<uint32_t> everything(total);
	for (size_t i = 0; i < total; ++i) 
	{
		everything[i] = static_cast<uint32_t>(i);
	}
	renderer->SetSelection(modelIndex, std::move(everything));
	m_viewport->RenderFrameBlocking();

	const double clearMs = MeasureMs([&]
	{
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking(); //Un-marks the splats and uploads
	});
	results.push_back({ "Deselect all: clear + frame", total, clearMs });
	return results;
}
