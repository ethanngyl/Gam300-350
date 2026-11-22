#include "StressTestRunner.h"

#include "splat/SplatGenerator.h"
#include "splat/SplatRenderer.h"
#include "ui/EditCommands.h"
#include "ui/Viewport.h"

#include <glm/gtc/matrix_transform.hpp>

#include <QElapsedTimer>
#include <QUndoStack>

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

	//Ascending indices 0, stride, 2 * stride, ... below total
	std::vector<uint32_t> MakeIndices(size_t total, size_t stride) {
		std::vector<uint32_t> indices;
		indices.reserve(total / stride + 1);
		for (size_t i = 0; i < total; i += stride) {
			indices.push_back(static_cast<uint32_t>(i));
		}
		return indices;
	}

	//Hover text for the rows, shared so every test words the two steps the same way
	const QString kCreateTip = "Builds the splat data in memory (CPU only).";
	const QString kApplyTip = "Makes the change in memory (CPU only).";
	const QString kRedrawTip = "Draws one frame so the change shows on screen. Updates the splat data and sends it to the graphics card (CPU + GPU).";
	const QString kTotalTip = "All the steps above added together.";
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
		{ "Load: Create splats", count, generateMs, kCreateTip },
		{ "Load: Add to scene", count, setMs, "Hands the splats to the renderer as a new model (CPU only). Nothing is drawn yet." },
		{ "Load: Redraw", count, frameMs, kRedrawTip },
		{ "Load: Total", count, generateMs + setMs + frameMs, kTotalTip },
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
	struct Case {
		const char* label;
		size_t stride;
	};
	const Case cases[] = { { "All", 1 }, { "Half", 2 }, { "Tenth", 10 } };

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
		results.push_back({ label + ": Apply", selected, setMs, kApplyTip });
		results.push_back({ label + ": Redraw", selected, frameMs, kRedrawTip });

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
	results.push_back({ "Deselect all: Apply + Redraw", total, clearMs,
		"Clears the selection in memory, then draws one frame so it shows on screen (CPU + GPU). Timed as one step." });
	return results;
}

std::vector<StressResult> StressTestRunner::TestMove() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	QUndoStack stack; //Private, the editor's own undo history is not touched
	const glm::vec3 offset(0.5f, 0.0f, 0.0f);
	std::vector<StressResult> results;

	//Moving the whole model only changes its transform, the splat data is not touched
	{
		const glm::mat4 before = model->GetTransform();
		const glm::mat4 after = glm::translate(before, offset);
		const double applyMs = MeasureMs([&] { stack.push(new MoveModelCommand(model, before, after)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		results.push_back({ "Move model: Apply", total, applyMs,
			"Changes the model's position (CPU only). The splats themselves are not rewritten." });
		results.push_back({ "Move model: Redraw", total, frameMs, kRedrawTip });

		stack.undo(); //Put the model back
		m_viewport->RenderFrameBlocking();
	}

	//Moving splats rewrites them in the model, so the whole splat array is rebuilt and uploaded again
	struct Case {
		const char* label;
		size_t stride;
		bool selected; //Select the splats first and move the selection, like the editor does
	};
	const Case cases[] = { { "all splats", 1, false }, { "half of splats", 2, false }, { "selected tenth", 10, true } };
	const glm::mat4 delta = glm::translate(glm::mat4(1.0f), offset);

	for (const Case& c : cases) {
		std::vector<uint32_t> indices = MakeIndices(total, c.stride);
		if (c.selected) {
			//Selecting is set up outside the timing, this test measures the move
			renderer->SetSelection(modelIndex, indices);
			m_viewport->RenderFrameBlocking();
			indices = renderer->Selection();
		}
		const size_t moved = indices.size();

		const double applyMs = MeasureMs([&] { stack.push(new MoveSplatsCommand(renderer, model, indices, delta)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Move %1").arg(c.label);
		results.push_back({ label + ": Apply", moved, applyMs,
			"Builds the undo data (the splats before and after the move) and moves them in memory (CPU only)." });
		results.push_back({ label + ": Redraw", moved, frameMs, kRedrawTip });

		//Put the splats back and clear the selection, so the next case starts the same way
		stack.undo();
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}
	return results;
}

std::vector<StressResult> StressTestRunner::TestDelete() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	QUndoStack stack; //Private, the editor's own undo history is not touched
	std::vector<StressResult> results;

	struct Case {
		const char* label;
		size_t stride;
		bool selected; //Select the splats first and delete the selection, like the editor does
	};
	const Case cases[] = { { "half of splats", 2, false }, { "selected tenth", 10, true } };

	for (const Case& c : cases) {
		std::vector<uint32_t> indices = MakeIndices(total, c.stride);
		if (c.selected) {
			//Selecting is set up outside the timing, this test measures the delete
			renderer->SetSelection(modelIndex, indices);
			m_viewport->RenderFrameBlocking();
			indices = renderer->Selection();
		}

		//1 = keep, 0 = delete, the mask is part of the setup
		std::vector<uint8_t> keepMask(total, 1);
		for (uint32_t index : indices) {
			keepMask[index] = 0;
		}
		const size_t deleted = indices.size();

		const double applyMs = MeasureMs([&] { stack.push(new RemoveSplatsCommand(renderer, model, keepMask)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Delete %1").arg(c.label);
		results.push_back({ label + ": Apply", deleted, applyMs,
			"Remembers the deleted splats for undo and removes them from the model in memory (CPU only)." });
		results.push_back({ label + ": Redraw", deleted, frameMs, kRedrawTip });

		//Bring the splats back and clear the selection, so the next case starts the same way
		stack.undo();
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}

	//Deleting a whole model cannot be undone, so delete a copy that only exists for this test
	if (renderer->ModelCount() < static_cast<size_t>(SplatRenderer::kMaxModels)) {
		renderer->SetSplats(model->splats(), "StressTestCopy");
		m_viewport->RenderFrameBlocking(); //Upload the copy first, so only the delete is timed below
		const int copyIndex = static_cast<int>(renderer->ModelCount()) - 1;

		const double applyMs = MeasureMs([&] { renderer->RemoveModel(copyIndex); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		results.push_back({ "Delete model: Apply", total, applyMs,
			"Removes the whole model from the scene in memory (CPU only)." });
		results.push_back({ "Delete model: Redraw", total, frameMs, kRedrawTip });
	}
	return results;
}
